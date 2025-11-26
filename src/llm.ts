// 基础配置
interface BaseProviderConfig {
  apiKey: string;
  model: string;
}

// 兼容 OpenAI API 的提供商（包括 OpenAI 自己）
interface OpenAICompatibleConfig extends BaseProviderConfig {
  baseURL?: string; // 对于 OpenAI 本身是可选的，对于其他兼容模型是必需的
}

// Gemini 的特定配置
interface GeminiConfig extends BaseProviderConfig {}

// Azure 的特定配置
interface AzureConfig extends BaseProviderConfig {
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
}

// 所有可能配置的联合类型
export type LlmProviderConfig =
  | OpenAICompatibleConfig
  | GeminiConfig
  | AzureConfig;

// 主配置对象的类型
export interface LlmConfig {
  defaultProvider: keyof LlmConfig['providers'];
  promptTemplate?: string;
  providers: {
    openai: OpenAICompatibleConfig;
    gemini: GeminiConfig;
    qwen: OpenAICompatibleConfig;
    deepseek: OpenAICompatibleConfig;
    azure_openai: AzureConfig;
  };
}
