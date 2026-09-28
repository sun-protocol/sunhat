import type {
  NormalizedSunhatConfig,
  SunhatUserConfig,
} from "../../../src/v2/config/index.js";

interface SunhatNetworkBindingUserConfig {
  sunhat?: {
    target?: string;
  };
}

declare module "hardhat/types/config" {
  interface HardhatUserConfig {
    sunhat?: SunhatUserConfig;
  }

  interface HardhatConfig {
    sunhat: NormalizedSunhatConfig;
  }

  interface HttpNetworkUserConfig extends SunhatNetworkBindingUserConfig {}

  interface EdrNetworkUserConfig extends SunhatNetworkBindingUserConfig {}
}
