import "./sunhat-v2-type-extensions.js";

import type { HardhatPlugin } from "hardhat/types/plugins";
import { definePlugin } from "hardhat/plugins";
import sunhatPluginDefinition from "../../../src/v2/plugin/index.js";

export default definePlugin(sunhatPluginDefinition as unknown as HardhatPlugin);
