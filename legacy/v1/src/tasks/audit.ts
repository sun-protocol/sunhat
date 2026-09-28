import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import OpenAI from 'openai';
import { AzureOpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LlmConfig, LlmProviderConfig } from '../llm';

type ProviderName = keyof LlmConfig['providers'];
type SupportedLanguage = 'solidity' | 'vyper';

interface AuditTaskArgs {
  contract?: string;
  provider?: ProviderName;
  format?: 'text' | 'json';
}

/**
 * 统一的 LLM 调用函数
 */
async function callLLM(
  provider: ProviderName,
  config: LlmProviderConfig,
  prompt: string
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  console.log(`[INFO] Using provider: ${provider}, model: ${config.model}`);

  switch (provider) {
    case 'openai':
    case 'qwen':
    case 'deepseek': {
      const openaiConfig = config as LlmConfig['providers']['openai'];
      const openai = new OpenAI({
        apiKey: openaiConfig.apiKey,
        baseURL: openaiConfig.baseURL,
      });
      const response = await openai.chat.completions.create({
        model: openaiConfig.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional and meticulous smart contract auditor.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });
      return response.choices[0].message.content ?? '';
    }
    case 'azure_openai': {
      const azureConfig = config as LlmConfig['providers']['azure_openai'];
      const azureClient = new AzureOpenAI({
        endpoint: azureConfig.endpoint,
        apiKey: azureConfig.apiKey,
        apiVersion: azureConfig.apiVersion,
        deployment: azureConfig.deploymentName,
      });

      console.log(`[INFO] Using model deployment: ${azureConfig.model}`);
      const response = await azureClient.chat.completions.create({
        model: azureConfig.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional and meticulous smart contract auditor.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });
      return response.choices[0].message.content ?? '';
    }
    case 'gemini': {
      const geminiConfig = config as LlmConfig['providers']['gemini'];
      const genAI = new GoogleGenerativeAI(geminiConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: geminiConfig.model });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    }

    default:
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

/**
 * 根据配置获取基础审计 Prompt
 */
function getBasePromptTemplate(llmConfig: LlmConfig): string {
  const defaultPromptTemplate = `As an expert smart contract auditor, please analyze the following {language} code.
The file name is '{contractName}'.

Your analysis should cover:
1.  **Security Vulnerabilities**: Identify potential risks.
2.  **Gas Optimization**: Suggest gas-saving improvements.
3.  **Best Practices**: Check for code style and common practices.`;

  const userPrompt = llmConfig.promptTemplate;
  return userPrompt || defaultPromptTemplate;
}

/**
 * 生成最终的审计 Prompt
 */
function getAuditPrompt(
  contractName: string,
  contractCode: string,
  format: 'text' | 'json',
  llmConfig: LlmConfig,
  language: SupportedLanguage
): string {
  const codeWithLineNumbers = contractCode
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');

  let basePrompt = getBasePromptTemplate(llmConfig);
  basePrompt = basePrompt
    .replace('{contractName}', contractName)
    .replace('{codeWithLineNumbers}', codeWithLineNumbers)
    .replace('{language}', language);

  if (format === 'json') {
    return `
      ${basePrompt}

      Your response MUST be a single, valid JSON array of objects, enclosed in a single \`\`\`json code block. Do not add any text before or after the JSON block.
      Each object in the array represents a single issue you've found and must conform to this exact structure:
      {
        'severity': 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO',
        'filePath': '${contractName}',
        'lineNumber': <number>,
        'message': '<A concise description of the issue>',
        'detailedDescription': '<A full explanation of the vulnerability or suggestion.>',
        'suggestion': '<A code snippet showing the recommended change. Use diff format if possible.>'
      }

      If you find no issues, return an empty array [].

      Now, analyze the following contract code:
      \`\`\`${language}
      ${codeWithLineNumbers}
      \`\`\`
    `;
  }

  return `
    ${basePrompt}

    **CRITICAL**: For each issue you find, you MUST format the title of the issue on a single line like this:
    [SEVERITY]|[FILE_PATH]:[LINE_NUMBER] - [BRIEF_DESCRIPTION]

    - **SEVERITY**: Use one of: HIGH, MEDIUM, LOW, INFO.
    - **FILE_PATH**: This MUST be the exact filename provided: ${contractName}.
    - **LINE_NUMBER**: The specific line number where the issue occurs.
    - **BRIEF_DESCRIPTION**: A short, one-sentence summary of the issue.

    After this title line, provide a detailed explanation and a code snippet with your suggested modification.

    Example of a single issue's format:
    ---
    MEDIUM|MyContract.sol:42 - Re-entrancy risk in the withdraw function.

    **Details**: The current implementation of the \`withdraw\` function updates the user's balance *after* the external call (transfer), which makes it vulnerable to a re-entrancy attack.

    **Recommendation**:
    \`\`\`diff
    - balance[msg.sender] = 0;
    - (bool sent, ) = msg.sender.call{value: amount}('');
    + (bool sent, ) = msg.sender.call{value: amount}('');
    + require(sent, 'Failed to send Ether');
    + balance[msg.sender] = 0;
    \`\`\`
    ---

    Now, analyze the following contract code:
    \`\`\`${language}
    ${codeWithLineNumbers}
    \`\`\`
  `;
}

// 提取 Markdown JSON
function extractJson(rawOutput: string): string {
  const match = rawOutput.match(/```json\s*(\[[\s\S]*?\])\s*```/);
  if (!match || !match[1]) {
    try {
      JSON.parse(rawOutput);
      return rawOutput;
    } catch (e) {
      throw new Error(
        'Could not find a valid JSON code block or parse the raw output as JSON.'
      );
    }
  }
  return match[1];
}

task('audit', 'Audits a smart contract using a specified LLM provider')
  .addOptionalParam(
    'contract',
    'The name of the contract file to audit (e.g., "MyContract.sol"). If not provided, audits all contracts.'
  )
  .addOptionalParam(
    'provider',
    'The LLM provider to use (openai, azure_openai, gemini, qwen, deepseek)'
  )
  .addOptionalParam('format', 'The output format: "text" (default) or "json"')
  .setAction(
    async (taskArgs: AuditTaskArgs, hre: HardhatRuntimeEnvironment) => {
      const {
        contract: contractArg,
        provider: providerArg,
        format: formatArg,
      } = taskArgs;
      const { llm: llmConfig } = hre.config;
      const format = formatArg || 'text';
      const provider = providerArg || llmConfig.defaultProvider;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const providerConfig = llmConfig.providers[provider] as any;

      if (!providerConfig || !providerConfig.apiKey) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.error(
          `\n[ERROR] Configuration for provider '${provider}' is missing or incomplete. Check your hardhat.config.ts and .env file.`
        );
        return;
      }

      let contractPaths: string[];
      const sourcesPath = hre.config.paths.sources;

      if (!contractArg || contractArg.toLowerCase() === 'all') {
        console.log(
          '[INFO] No specific contract provided. Auditing all contracts...'
        );
        contractPaths = await glob(`${sourcesPath}/**/*.{sol,vy}`);
      } else {
        contractPaths = [path.resolve(sourcesPath, contractArg)];
      }

      if (contractPaths.length === 0) {
        console.error('\n[ERROR] No contract files found to audit.');
        return;
      }

      console.log(`[INFO] Found ${contractPaths.length} contract(s) to audit.`);

      const allIssues: any[] = [];
      for (const contractPath of contractPaths) {
        const contractName = path.basename(contractPath);

        const extension = path.extname(contractPath).substring(1); // 'sol' or 'vy'
        let language: SupportedLanguage;

        if (extension === 'sol') {
          language = 'solidity';
        } else if (extension === 'vy') {
          language = 'vyper';
        } else {
          console.warn(
            `[WARN] Unsupported file type '.${extension}' for ${contractName}. Skipping.`
          );
          continue;
        }

        console.log(`\n---------------------------------------------`);
        console.log(`  Auditing: ${contractName} (${language})`);
        console.log(`---------------------------------------------\n`);

        let contractCode: string;
        try {
          const resolvedPath = path.resolve(
            hre.config.paths.sources,
            contractName
          );
          contractCode = fs.readFileSync(resolvedPath, 'utf8');
          console.log(`[INFO] Successfully read contract: ${contractName}`);
        } catch (error) {
          console.error(
            `\n[ERROR] Could not read contract file: ${contractName}.`
          );
          continue;
        }

        const prompt = getAuditPrompt(
          contractName,
          contractCode,
          format,
          llmConfig,
          language
        );

        try {
          console.log(
            `[INFO] Sending code to LLM for analysis (format: ${format})...`
          );
          const rawAnalysis = await callLLM(provider, providerConfig, prompt);
          console.log(`\n=============================================`);
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          console.log(
            `    🤖 LLM Audit Report for ${contractName} (${(
              provider as string
            ).toUpperCase()})`
          );
          console.log(`=============================================\n`);
          console.log(rawAnalysis);
          if (format === 'json') {
            const jsonString = extractJson(rawAnalysis);
            try {
              const parsedJson = JSON.parse(jsonString);
              allIssues.push(...parsedJson);
            } catch (e) {
              console.error(
                "\n[ERROR] Failed to parse the JSON extracted from the LLM's response."
              );
              if (e instanceof SyntaxError) {
                console.error('Syntax Error:', e.message);
              }
              console.error(
                'Extracted string that failed to parse:',
                jsonString
              );
            }
          }
        } catch (error: any) {
          console.error(
            `\n[ERROR] An error occurred during the audit  of ${contractName}:`
          );
          console.error(error.message);
        }
      }
      if (format === 'json') {
        if (allIssues.length > 0) {
          const formattedJsonString = JSON.stringify(allIssues, null, 2);
          const outputPath = path.join(
            hre.config.paths.root,
            'audit-report.json'
          );
          fs.writeFileSync(outputPath, formattedJsonString, 'utf8');
          console.log(
            `\n✅ [SUCCESS] Combined audit report for ${contractPaths.length} contract(s) has been saved to: ${outputPath}`
          );
        } else {
          console.log(
            `\n✅ [SUCCESS] All contracts were audited, and no issues were found.`
          );
        }
      }
    }
  );
