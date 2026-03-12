import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";

// Mock API for browser-only dev (when Electron bridge is not available)
if (!window.mutatr) {
  const mockProjects = [
    { id: 'p1', name: 'My Website', rootPath: '/Users/test/my-website', pages: [
      { id: 'pg1', route: '/home', filePath: '/pages/home.tsx', thumbnailDataUrl: '' },
      { id: 'pg2', route: '/about', filePath: '/pages/about.tsx', thumbnailDataUrl: '' },
      { id: 'pg3', route: '/pricing', filePath: '/pages/pricing.tsx', thumbnailDataUrl: '' },
      { id: 'pg4', route: '/blog', filePath: '/pages/blog.tsx', thumbnailDataUrl: '' },
    ], personas: [
      { id: 'pr1', name: 'Tech-Savvy Millennial', summary: 'Young professional interested in productivity tools', ageBand: '25-34', motivations: ['Efficiency', 'Innovation'], painPoints: ['Complexity', 'High prices'], tone: 'Casual', preferredChannels: ['Social media', 'Email'] },
      { id: 'pr2', name: 'Budget-Conscious Parent', summary: 'Parent looking for affordable family solutions', ageBand: '35-44', motivations: ['Savings', 'Family safety'], painPoints: ['Hidden costs', 'Complicated UX'], tone: 'Friendly', preferredChannels: ['Email', 'Search'] },
      { id: 'pr3', name: 'Enterprise Buyer', summary: 'Decision maker at a large organization', ageBand: '40-55', motivations: ['ROI', 'Scalability'], painPoints: ['Vendor lock-in', 'Poor support'], tone: 'Professional', preferredChannels: ['LinkedIn', 'Webinars'] },
    ], experiments: [
      {
        id: 'exp1',
        name: 'Homepage CTA optimization',
        pageId: 'pg1',
        createdAt: '2026-03-01T10:00:00Z',
        tests: [
          { id: 't1', title: 'Simplify hero CTA', hypothesis: 'Reducing CTA options from 3 to 1 will increase click-through rate by making the desired action more obvious to users.', expectedImpact: '+15% CTR on primary action', implementationPrompt: '', riskLevel: 'low' },
          { id: 't2', title: 'Add social proof section', hypothesis: 'Adding customer logos and testimonials builds trust and reduces anxiety about purchasing.', expectedImpact: '+8% conversion rate', implementationPrompt: '', riskLevel: 'medium' },
          { id: 't3', title: 'Redesign pricing toggle', hypothesis: 'A clearer monthly/annual toggle reduces confusion and improves plan selection.', expectedImpact: '+12% annual plan selection', implementationPrompt: '', riskLevel: 'high' },
        ],
        renders: [
          { id: 'r1', testId: 't1', title: 'Simplified Hero CTA', route: '/home', screenshotDataUrl: '' },
          { id: 'r2', testId: 't2', title: 'With Social Proof', route: '/home', screenshotDataUrl: '' },
        ],
        attention: null,
      },
      {
        id: 'exp2',
        name: 'Pricing page experiment',
        pageId: 'pg3',
        createdAt: '2026-03-02T14:00:00Z',
        tests: [],
        renders: [],
        attention: null,
      },
    ], lastUpdatedAt: '2026-03-01T10:00:00Z' },
    { id: 'p2', name: 'Dashboard App', rootPath: '/Users/test/dashboard', pages: [
      { id: 'pg5', route: '/dashboard', filePath: '/pages/dashboard.tsx', thumbnailDataUrl: '' },
      { id: 'pg6', route: '/settings', filePath: '/pages/settings.tsx', thumbnailDataUrl: '' },
    ], personas: [
      { id: 'pr4', name: 'Power User', summary: 'Advanced user who uses all features daily', ageBand: '25-40', motivations: ['Productivity'], painPoints: ['Slow loading'], tone: 'Direct', preferredChannels: ['App notifications'] },
    ], experiments: [], lastUpdatedAt: '2026-03-01T10:00:00Z' },
  ];
  (window as any).mutatr = {
    onProgress: () => () => {},
    listProjects: async () => ({ ok: true, payload: mockProjects }),
    getSettings: async () => ({ ok: true, payload: { hasClaudeApiKey: true, maskedClaudeApiKey: 'sk-ant-...xyz', apiKeyStorage: 'env', suggestionModel: 'sonnet', implementationModel: 'opus', personasModel: 'haiku', attentionModel: 'inherit' } }),
    addProject: async () => ({ ok: false, error: 'Not available in mock mode' }),
    removeProject: async () => ({ ok: true, payload: null }),
    refreshPages: async () => ({ ok: false, error: 'Not available in mock mode' }),
    refreshPersonas: async () => ({ ok: false, error: 'Not available in mock mode' }),
    suggestTests: async () => ({ ok: false, error: 'Not available in mock mode' }),
    implementTests: async () => ({ ok: false, error: 'Not available in mock mode' }),
    runAttention: async () => ({ ok: true, payload: { heatmaps: {}, controlHeatmaps: {}, variantSummaries: {} } }),
    addPersona: async () => ({ ok: false, error: 'Not available in mock mode' }),
    updateSettings: async () => ({ ok: false, error: 'Not available in mock mode' }),
    createExperiment: async () => ({ ok: false, error: 'Not available in mock mode' }),
    deleteExperiment: async () => ({ ok: false, error: 'Not available in mock mode' }),
    setExperimentPage: async () => ({ ok: false, error: 'Not available in mock mode' }),
  };
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found.");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
