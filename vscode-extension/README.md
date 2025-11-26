# Sunhat VSCode Extension

<p align="center">
  <img src="images/logo.png" width="200">
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=sun-protocol.sunhat-vscode-extension">
    <img src="https://img.shields.io/visual-studio-marketplace/v/sun-protocol.sunhat-vscode-extension?style=for-the-badge&label=VS%20Marketplace&color=blue" alt="VS Marketplace Version">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=sun-protocol.sunhat-vscode-extension">
    <img src="https://img.shields.io/visual-studio-marketplace/i/sun-protocol.sunhat-vscode-extension?style=for-the-badge&color=brightgreen" alt="Installs">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=sun-protocol.sunhat-vscode-extension&ssr=false#review-details">
    <img src="https://img.shields.io/visual-studio-marketplace/r/sun-protocol.sunhat-vscode-extension?style=for-the-badge&color=yellow" alt="Rating">
  </a>
</p>

The essential VS Code extension pack for Web3 developers using Sunhat. Streamline your smart contract development, testing, and deployment lifecycle with this all-in-one toolkit.

## ✨ Core Features

*   🤖 **AI-Powered Code Audits**: Get instant security and optimization feedback directly in your editor. Powered by Large Language Models (LLMs), Sunhat identifies potential issues in your **Solidity** and **Vyper** code, displaying them as in-line diagnostics.
*   **Integrated Test Runner**: Visualize, run, and debug your Sunhat tests directly within the VS Code Test Explorer.
*   **Full Language Support**: Comprehensive syntax highlighting, code completion, and error checking for both Solidity and Vyper.
*   **Accelerated Development**: Write code faster with intelligent snippets for common Solidity patterns and Sunhat tests.
*   **All-in-One Setup**: Get the most critical extensions for Sunhat development with a single install.

---

## 🚀 Features & Setup

This toolkit offers two powerful, integrated features: **AI-Powered Auditing** and the **Test Explorer**.

### 🤖 1. AI-Powered Auditing

Bring the power of AI to your workflow. Audit your contracts and see the results without ever leaving VS Code.

<!-- 建议在这里放一个功能演示动图 (GIF) -->
<!-- ![Sunhat AI Audit Demo](https://path/to/your/demo.gif) -->

**How it works:**
1.  You run a Hardhat task (`npx hardhat audit`).
2.  The task sends your code to a configured LLM (e.g., GPT-4, Gemini).
3.  The AI's analysis is saved to an `audit-report.json` file.
4.  The Sunhat extension automatically reads this file and displays the findings as diagnostics (wavy underlines) in your code.

**Setup Guide:**

**Step 1: Configure Hardhat**

In your `hardhat.config.ts`, add an `llm` configuration block. You'll also need to set your API keys in a `.env` file.

```typescript
// hardhat.config.ts
import 'dotenv/config'; // Make sure to import this

// ... your existing config

const config: HardhatUserConfig = {
  // ... solidity, paths, etc.
  llm: {
    defaultProvider: 'openai', // or 'gemini', 'qwen', etc.
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-4-turbo-preview',
      },
      // You can add other providers here
    },
  },
};

export default config;
```

**Step 2: Run the Audit**

Execute the audit task from your terminal. The `--format json` flag is **required** for the VS Code integration to work.

```bash
# This will audit all .sol and .vy contracts in your project
npx hardhat audit --format json
```

**Step 3: View Results in VS Code**

That's it! The Sunhat extension will automatically detect the generated `audit-report.json` and display the issues. Hover over any underlined code to see detailed descriptions and AI-generated suggestions.

### 🧪 2. Test Explorer

**Step 1: Configure `settings.json`**

In your project's `.vscode/settings.json` file, add the following to connect the Test Explorer to Hardhat:

```jsonc
// .vscode/settings.json
{
  "mochaExplorer.files": "test/**/*.ts",
  "mochaExplorer.require": "hardhat/register"
}
```

**Step 2: Reload and Explore**

Reload your VS Code window (`Cmd+Shift+P` -> `Developer: Reload Window`). The Test icon will appear in your activity bar, ready for you to run and debug tests.

---

## 📦 Extensions Included

This toolkit bundles the following industry-standard extensions to power its features:

| Extension                                                                                    | Publisher         | Description                                                        |
| -------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| [Solidity](https://marketplace.visualstudio.com/items?itemName=NomicFoundation.hardhat-solidity) | Nomic Foundation  | Provides language support for Solidity, essential for the audit feature. |
| [Vyper](https://marketplace.visualstudio.com/items?itemName=tintinweb.vscode-vyper)              | tintinweb         | Provides language support for Vyper, essential for the audit feature. |
| [Test Explorer for Mocha](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-mocha-test-adapter) | hbenl             | Integrates Mocha tests into the VS Code side panel. |
| [Solidity Snippets](https://marketplace.visualstudio.com/items?itemName=maratib.solidity-snippets) | maratib           | A handy collection of code snippets for common Solidity patterns.  |
| [Hardhat Test Snippets](https://marketplace.visualstudio.com/items?itemName=maratib.hardhat-test-snippets) | maratib           | Speeds up test writing with snippets for Chai matchers and Hardhat tasks. |


---

Happy Hacking!

