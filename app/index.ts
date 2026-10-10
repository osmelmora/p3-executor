import { defineApp, router } from "apps";
import { modelsRouter, requirements } from "./lib/tools.js";

export default defineApp(requirements, {
  tools: router({ models: modelsRouter }),
});
