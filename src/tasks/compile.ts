import { task, subtask } from 'hardhat/config';
import {
  TASK_COMPILE,
  TASK_COMPILE_SOLIDITY_LOG_COMPILATION_ERRORS,
} from 'hardhat/builtin-tasks/task-names';
import fs from 'fs-extra';
import path from 'path';

/**
 * Appends issues to the compilation-errors.json file.
 */
function reportIssues(hre: any, issues: any[], append: boolean = false) {
  const errorFilePath = path.join(
    hre.config.paths.root,
    'compilation-errors.json'
  );
  let allIssues = issues;

  if (append && fs.existsSync(errorFilePath)) {
    try {
      const existing = fs.readJsonSync(errorFilePath);
      if (Array.isArray(existing)) {
        allIssues = [...existing, ...issues];
      }
    } catch (e) {
      // Ignore read errors
    }
  }

  fs.writeJsonSync(errorFilePath, allIssues, { spaces: 2 });
  (hre as any)._sunhatIssuesCount =
    ((hre as any)._sunhatIssuesCount || 0) + issues.length;
}

task(TASK_COMPILE).setAction(async (args, hre, runSuper) => {
  (hre as any)._sunhatIssuesCount = 0;
  (hre as any)._solidityErrorsCaptured = false;

  try {
    await runSuper(args);

    // Clear the file only if no issues (errors/warnings) were reported during the entire process
    if (((hre as any)._sunhatIssuesCount || 0) === 0) {
      reportIssues(hre, []);
    }
  } catch (error: any) {
    // If Solidity didn't already capture and report detailed errors,
    // or if the failure is NOT the standard Solidity failure, try to parse it.
    if (
      !(hre as any)._solidityErrorsCaptured ||
      !error.message.includes('HH600')
    ) {
      let errors = [];
      let filePath = 'hardhat.config.ts';

      if (error.cmd) {
        const cmdMatch = error.cmd.match(/\s([^\s]+\.vy)$/);
        if (cmdMatch) filePath = cmdMatch[1];
      }

      const lineColMatch = error.message.match(/line (\d+):(\d+)/);
      const lineOnlyMatch = error.message.match(/line (\d+)/);
      const arrowMatch = error.message.match(
        /(?:-->\s+)?([^:\s\n]+):(\d+):(\d+):/
      );

      if (lineColMatch || lineOnlyMatch || arrowMatch) {
        let line = 0;
        let column = 0;

        if (arrowMatch) {
          filePath = arrowMatch[1];
          line = parseInt(arrowMatch[2]);
          column = parseInt(arrowMatch[3]);
        } else if (lineColMatch) {
          line = parseInt(lineColMatch[1]);
          column = parseInt(lineColMatch[2]);
        } else if (lineOnlyMatch) {
          line = parseInt(lineOnlyMatch[1]);
        }

        const messageLines = error.message.split('\n');
        const exceptionLine = messageLines.find(
          (l: string) => l.includes('Exception:') || l.includes('Error:')
        );
        const message = exceptionLine
          ? exceptionLine.trim()
          : error.message.split('\n')[0];

        errors.push({
          filePath,
          line,
          column,
          severity: 'error',
          message,
          original: error.message,
        });
      }

      if (errors.length === 0) {
        errors.push({
          filePath: 'hardhat.config.ts',
          line: 0,
          column: 0,
          severity: 'error',
          message: error.message,
          original: error.message,
        });
      }

      // Append if we already have some (e.g. Solidity warnings followed by Vyper error)
      reportIssues(hre, errors, ((hre as any)._sunhatIssuesCount || 0) > 0);
    }
    throw error;
  }
});

subtask(TASK_COMPILE_SOLIDITY_LOG_COMPILATION_ERRORS).setAction(
  async (taskArgs: any, hre, runSuper) => {
    const outputErrors = taskArgs.output?.errors || [];
    const validIssues = [];
    let hasStrictError = false;

    for (const issue of outputErrors) {
      let filePath = issue.sourceLocation?.file || 'unknown';
      let line = 0;
      let column = 0;
      const severity = issue.severity || 'error';
      if (severity === 'error') hasStrictError = true;

      if (issue.formattedMessage) {
        const match = issue.formattedMessage.match(
          /(?:-->\s+)?([^:\s\n]+):(\d+):(\d+):/
        );
        if (match) {
          if (filePath === 'unknown') filePath = match[1];
          line = parseInt(match[2]);
          column = parseInt(match[3]);
        }
      }

      validIssues.push({
        filePath,
        line,
        column,
        severity,
        message: issue.message || issue.formattedMessage,
        original: issue.formattedMessage,
        detailed: issue,
      });
    }

    if (hasStrictError) {
      (hre as any)._solidityErrorsCaptured = true;
    }

    reportIssues(hre, validIssues, ((hre as any)._sunhatIssuesCount || 0) > 0);
    return runSuper(taskArgs);
  }
);
