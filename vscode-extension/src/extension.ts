import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface AuditIssue {
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  filePath: string;
  lineNumber: number;
  message: string;
  detailedDescription: string;
  suggestion: string;
}

const diagnosticCollection =
  vscode.languages.createDiagnosticCollection('SunhatAuditor');
const compilationDiagnosticCollection =
  vscode.languages.createDiagnosticCollection('SunhatCompilation');

const SUPPORTED_LANGUAGE_IDS = ['solidity', 'vyper'];

function updateDiagnostics(document: vscode.TextDocument): void {
  if (!SUPPORTED_LANGUAGE_IDS.includes(document.languageId)) {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return;
  }
  const reportPath = path.join(workspaceFolder.uri.fsPath, 'audit-report.json');

  if (!fs.existsSync(reportPath)) {
    diagnosticCollection.delete(document.uri);
    return;
  }

  try {
    const reportContent = fs.readFileSync(reportPath, 'utf8');
    const issues: AuditIssue[] = JSON.parse(reportContent);

    const diagnostics: vscode.Diagnostic[] = [];
    const fileName = path.basename(document.uri.fsPath);

    for (const issue of issues) {
      if (path.basename(issue.filePath) === fileName) {
        const line = issue.lineNumber > 0 ? issue.lineNumber - 1 : 0;

        if (line >= document.lineCount) continue;

        const range = new vscode.Range(
          line,
          0,
          line,
          document.lineAt(line).range.end.character
        );

        const severityMap = {
          HIGH: vscode.DiagnosticSeverity.Error,
          MEDIUM: vscode.DiagnosticSeverity.Warning,
          LOW: vscode.DiagnosticSeverity.Information,
          INFO: vscode.DiagnosticSeverity.Hint,
        };
        const severity =
          severityMap[issue.severity] || vscode.DiagnosticSeverity.Information;

        const diagnostic = new vscode.Diagnostic(
          range,
          issue.message,
          severity
        );
        diagnostic.code = issue.filePath;
        diagnostic.source = 'Sunhat Auditor';
        (diagnostic as any).auditInfo = {
          detailedDescription: issue.detailedDescription,
          suggestion: issue.suggestion,
        };

        diagnostics.push(diagnostic);
      }
    }

    diagnosticCollection.set(document.uri, diagnostics);
  } catch (e) {
    console.error(`[Sunhat Auditor] Error processing audit report: ${e}`);
    diagnosticCollection.delete(document.uri);
  }
}
interface CompilationError {
  filePath: string;
  line: number;
  column: number;
  severity: string;
  message: string;
  original: string;
}

function updateCompilationDiagnostics(document?: vscode.TextDocument): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;

  const reportPath = path.join(
    workspaceFolders[0].uri.fsPath,
    'compilation-errors.json'
  );
  if (!fs.existsSync(reportPath)) {
    compilationDiagnosticCollection.clear();
    return;
  }

  try {
    const reportContent = fs.readFileSync(reportPath, 'utf8');
    const issues: CompilationError[] = JSON.parse(reportContent);

    const diagnosticsMap = new Map<string, vscode.Diagnostic[]>();

    // Group issues by file
    for (const issue of issues) {
      // Normalize path
      let absolutePath = issue.filePath;
      if (!path.isAbsolute(absolutePath)) {
        absolutePath = path.join(
          workspaceFolders[0].uri.fsPath,
          issue.filePath
        );
      }
      const uri = vscode.Uri.file(absolutePath);
      const uriStr = uri.toString();

      if (!diagnosticsMap.has(uriStr)) {
        diagnosticsMap.set(uriStr, []);
      }

      const line = issue.line > 0 ? issue.line - 1 : 0;
      const column = issue.column > 0 ? issue.column - 1 : 0;

      const range = new vscode.Range(line, column, line, column + 100); // Approximate end

      let severity = vscode.DiagnosticSeverity.Error;
      if (issue.severity === 'warning')
        severity = vscode.DiagnosticSeverity.Warning;
      else if (issue.severity === 'info')
        severity = vscode.DiagnosticSeverity.Information;

      const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
      diagnostic.source = 'Sunhat';
      diagnosticsMap.get(uriStr)!.push(diagnostic);
    }

    compilationDiagnosticCollection.clear();
    diagnosticsMap.forEach((diags, uriStr) => {
      compilationDiagnosticCollection.set(vscode.Uri.parse(uriStr), diags);
    });
  } catch (e) {
    console.error(`[Sunhat] Error reading compilation errors: ${e}`);
  }
}

function registerHoverProvider(): vscode.Disposable {
  return vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGE_IDS, {
    provideHover(document, position, token) {
      const diagnostics = diagnosticCollection.get(document.uri);
      if (!diagnostics) {
        return null;
      }

      const llmDiagnostic = diagnostics.find(
        (d) => d.source === 'Sunhat Auditor' && d.range.contains(position)
      );

      if (!llmDiagnostic || !(llmDiagnostic as any).auditInfo) {
        return null;
      }

      const auditInfo = (llmDiagnostic as any).auditInfo;

      const contents = new vscode.MarkdownString();
      contents.isTrusted = true;
      contents.supportThemeIcons = true;

      contents.appendMarkdown(
        `### $(zap) Sunhat Auditor: ${llmDiagnostic.message}\n\n`
      );
      contents.appendMarkdown(
        `**Details:** ${auditInfo.detailedDescription}\n\n---\n\n`
      );

      contents.appendMarkdown(`**Suggestion:**\n`);
      if (auditInfo.suggestion.includes('```diff')) {
        contents.appendMarkdown(auditInfo.suggestion);
      } else {
        contents.appendCodeblock(auditInfo.suggestion, document.languageId);
      }

      return new vscode.Hover(contents);
    },
  });
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerHoverProvider());
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc) updateDiagnostics(doc);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc) updateDiagnostics(doc);
    })
  );

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    // Watch audit-report.json
    const reportPath = path.join(
      workspaceFolders[0].uri.fsPath,
      'audit-report.json'
    );
    const fileWatcher = vscode.workspace.createFileSystemWatcher(reportPath);

    const updateDiagnosticsForAllOpenFiles = () => {
      vscode.workspace.textDocuments.forEach((doc) => {
        if (SUPPORTED_LANGUAGE_IDS.includes(doc.languageId)) {
          updateDiagnostics(doc);
        }
      });
    };

    fileWatcher.onDidCreate(updateDiagnosticsForAllOpenFiles);
    fileWatcher.onDidChange(updateDiagnosticsForAllOpenFiles);
    fileWatcher.onDidDelete(updateDiagnosticsForAllOpenFiles);

    context.subscriptions.push(fileWatcher);

    // Watch compilation-errors.json
    const compilationWatcher = vscode.workspace.createFileSystemWatcher(
      path.join(workspaceFolders[0].uri.fsPath, 'compilation-errors.json')
    );
    compilationWatcher.onDidCreate(() => updateCompilationDiagnostics());
    compilationWatcher.onDidChange(() => updateCompilationDiagnostics());
    compilationWatcher.onDidDelete(() =>
      compilationDiagnosticCollection.clear()
    );
    context.subscriptions.push(compilationWatcher);

    // Initial check
    updateCompilationDiagnostics();
  }

  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document);
  }
}

export function deactivate(): void {
  diagnosticCollection.clear();
  compilationDiagnosticCollection.clear();
}
