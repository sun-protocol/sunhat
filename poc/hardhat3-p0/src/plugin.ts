import "./type-extensions.js";

import { definePlugin } from "hardhat/plugins";

export default definePlugin({
  id: "sunhat-p0-connection-probe",
  hookHandlers: {
    network: () => import("./network-hook.js"),
  },
});
