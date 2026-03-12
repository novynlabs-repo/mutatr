/// <reference types="vite/client" />

import type { MutatrApi } from "./types/contracts";

declare global {
  interface Window {
    mutatr: MutatrApi;
    __MUTATR_PERSONA__?: unknown;
  }
}
