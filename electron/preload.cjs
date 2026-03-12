const { contextBridge, ipcRenderer } = require("electron");

const api = {
  onProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("mutatr:progress", handler);
    return () => ipcRenderer.removeListener("mutatr:progress", handler);
  },
  onProjectUpdated: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("mutatr:project:updated", handler);
    return () => ipcRenderer.removeListener("mutatr:project:updated", handler);
  },
  getSettings: () => ipcRenderer.invoke("mutatr:settings:get"),
  updateSettings: (payload) => ipcRenderer.invoke("mutatr:settings:update", payload),

  listProjects: () => ipcRenderer.invoke("mutatr:projects:list"),
  addProject: (selectedPath) => ipcRenderer.invoke("mutatr:projects:add", selectedPath),
  removeProject: (projectId) => ipcRenderer.invoke("mutatr:projects:remove", projectId),
  refreshPages: (projectId) => ipcRenderer.invoke("mutatr:pages:refresh", projectId),

  refreshPersonas: (projectId) => ipcRenderer.invoke("mutatr:personas:refresh", projectId),
  addPersona: (projectId, payload) => ipcRenderer.invoke("mutatr:personas:add", projectId, payload),

  createExperiment: (projectId, name) =>
    ipcRenderer.invoke("mutatr:experiments:create", projectId, name),
  deleteExperiment: (projectId, experimentId) =>
    ipcRenderer.invoke("mutatr:experiments:delete", projectId, experimentId),
  setExperimentPage: (projectId, experimentId, pageId) =>
    ipcRenderer.invoke("mutatr:experiments:set-page", projectId, experimentId, pageId),
  setExperimentGoal: (projectId, experimentId, goal) =>
    ipcRenderer.invoke("mutatr:experiments:set-goal", projectId, experimentId, goal),

  suggestTests: (projectId, experimentId) =>
    ipcRenderer.invoke("mutatr:pages:suggest-tests", projectId, experimentId),
  implementTests: (projectId, experimentId, selectedTestIds) =>
    ipcRenderer.invoke("mutatr:pages:implement-tests", projectId, experimentId, selectedTestIds),
  runAttention: (projectId, experimentId, renderIds, personaIds, visitors) =>
    ipcRenderer.invoke("mutatr:pages:run-attention", projectId, experimentId, renderIds, personaIds, visitors),
  pushRenderAsPR: (projectId, experimentId, renderId) =>
    ipcRenderer.invoke("mutatr:experiments:push-render-pr", projectId, experimentId, renderId),
};

contextBridge.exposeInMainWorld("mutatr", api);
