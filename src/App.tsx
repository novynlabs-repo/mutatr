import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FlaskConical,
  Plus,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { unwrap } from "./lib/api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import type {
  AppSettings,
  AttentionPayload,
  AttentionResult,
  ExperimentRecord,
  PersonaRecord,
  ProgressLine,
  ProjectRecord,
  RenderRecord,
  ScoreMetricKey,
  TestSuggestion,
} from "./types/contracts";

type TabId = "experiments" | "personas";
type PagesStage = "choose_page" | "goal" | "tests" | "renders" | "personas" | "results";

const WORKFLOW_STEPS: { id: PagesStage; title: string }[] = [
  { id: "choose_page", title: "Choose page" },
  { id: "goal", title: "Goal" },
  { id: "tests", title: "Treatments" },
  { id: "renders", title: "Renders" },
  { id: "personas", title: "Personas" },
  { id: "results", title: "Results" },
];

function modelOptions(defaultLabel: string) {
  return [
    { value: "inherit", label: `Default (${defaultLabel})` },
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
  ];
}

const SUGGESTION_MODEL_OPTIONS = modelOptions("Opus");
const IMPLEMENTATION_MODEL_OPTIONS = modelOptions("Sonnet");
const PERSONAS_MODEL_OPTIONS = modelOptions("Opus");
const ATTENTION_MODEL_OPTIONS = modelOptions("Haiku");

const SCORE_METRICS: { key: ScoreMetricKey; label: string }[] = [
  { key: "messageClarity", label: "Message clarity" },
  { key: "ctaClarity", label: "CTA clarity" },
  { key: "trustVisibility", label: "Trust visibility" },
  { key: "distractionControl", label: "Distraction control" },
  { key: "informationHierarchy", label: "Information hierarchy" },
  { key: "personaFit", label: "Persona fit" },
  { key: "frictionReduction", label: "Friction reduction" },
  { key: "accessibilitySafety", label: "Accessibility safety" },
  { key: "mobileResilience", label: "Mobile resilience" },
  { key: "performanceSafety", label: "Performance safety" },
];

function formatSignedScore(value: number) {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function verdictTone(verdict?: string) {
  if (verdict === "win") return "win";
  if (verdict === "risk") return "risk";
  return "mixed";
}

function issueTone(severity?: string) {
  if (severity === "high") return "risk";
  return "mixed";
}

function impactTone(impact?: string) {
  if (impact === "positive") return "win";
  if (impact === "negative") return "risk";
  return "mixed";
}

function metricTitle(metricKey?: ScoreMetricKey) {
  return SCORE_METRICS.find((metric) => metric.key === metricKey)?.label ?? metricKey ?? "";
}

function LoadingIndicator({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="spinner" />
      <div>
        <h4>{title}</h4>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function ProgressPanel({
  title,
  detail,
  lines,
  expandedIds,
  onToggle,
}: {
  title: string;
  detail: string;
  lines: ProgressLine[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const tokenEndRef = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    for (const line of lines) {
      if (expandedIds.has(line.id)) {
        const el = tokenEndRef.current.get(line.id);
        el?.scrollIntoView({ block: "end" });
      }
    }
  }, [lines, expandedIds]);

  if (lines.length === 0) {
    return <LoadingIndicator title={title} detail={detail} />;
  }

  // Group lines: preserve insertion order of groups
  const groups: { name: string | undefined; lines: ProgressLine[] }[] = [];
  const groupIndex = new Map<string | undefined, number>();
  for (const line of lines) {
    const key = line.group;
    if (groupIndex.has(key)) {
      groups[groupIndex.get(key)!].lines.push(line);
    } else {
      groupIndex.set(key, groups.length);
      groups.push({ name: key, lines: [line] });
    }
  }

  const renderLine = (line: ProgressLine) => {
    const expanded = expandedIds.has(line.id);
    return (
      <div key={line.id} className="progress-line">
        <button
          className="progress-line-header"
          onClick={() => onToggle(line.id)}
        >
          <span className={`progress-dot ${line.status}`} />
          <span className="progress-line-label">{line.label}</span>
          <ChevronRight
            size={12}
            className={`progress-chevron ${expanded ? "expanded" : ""}`}
          />
        </button>
        {expanded && (
          <div className="progress-token-window">
            <pre className="progress-tokens">
              {line.tokens || "Waiting for output..."}
            </pre>
            <div ref={(el) => { tokenEndRef.current.set(line.id, el); }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="progress-panel" role="status" aria-live="polite">
      <div className="progress-header">
        <div className="spinner" />
        <div>
          <h4>{title}</h4>
          <p>{detail}</p>
        </div>
      </div>
      <div className="progress-lines">
        {groups.map((g, i) =>
          g.name ? (
            <div key={g.name} className="progress-group">
              <div className="progress-group-label">{g.name}</div>
              {g.lines.map(renderLine)}
            </div>
          ) : (
            <div key={`ungrouped-${i}`}>{g.lines.map(renderLine)}</div>
          )
        )}
      </div>
    </div>
  );
}

export default function App() {
  const api = window.mutatr;

  /* ── Core state ── */
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("experiments");
  const [pagesStage, setPagesStage] = useState<PagesStage>("choose_page");

  const [activeExperimentId, setActiveExperimentId] = useState<string | null>(null);
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [selectedRenderIds, setSelectedRenderIds] = useState<string[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [attention, setAttention] = useState<AttentionResult | null>(null);
  const [visitorCount, setVisitorCount] = useState(10);
  const [goalInput, setGoalInput] = useState("");
  const [selectedResultVariantId, setSelectedResultVariantId] = useState<string | null>(null);
  const [selectedResultPersonaId, setSelectedResultPersonaId] = useState<string | null>(null);
  const [comparisonSliderPos, setComparisonSliderPos] = useState(50);

  const [showNewExperimentForm, setShowNewExperimentForm] = useState(false);
  const [newExperimentName, setNewExperimentName] = useState("");

  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [pushingPR, setPushingPR] = useState(false);
  const [progressLines, setProgressLines] = useState<ProgressLine[]>([]);
  const [expandedProgressIds, setExpandedProgressIds] = useState<Set<string>>(new Set());

  const [showPersonaForm, setShowPersonaForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [claudeApiKeyInput, setClaudeApiKeyInput] = useState("");
  const [suggestionModelInput, setSuggestionModelInput] = useState("inherit");
  const [implementationModelInput, setImplementationModelInput] = useState("inherit");
  const [personasModelInput, setPersonasModelInput] = useState("inherit");
  const [attentionModelInput, setAttentionModelInput] = useState("inherit");
  const autoRefreshedProjectsRef = useRef<Set<string>>(new Set());

  /* ── Sidebar state ── */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const onSidebarEnter = useCallback(() => {
    if (sidebarTimer.current) { clearTimeout(sidebarTimer.current); sidebarTimer.current = null; }
    setSidebarOpen(true);
  }, []);

  const onSidebarLeave = useCallback(() => {
    if (sidebarTimer.current) clearTimeout(sidebarTimer.current);
    sidebarTimer.current = setTimeout(() => setSidebarOpen(false), 200);
  }, []);

  const [personaDraft, setPersonaDraft] = useState({
    name: "",
    summary: "",
    ageBand: "",
    motivations: "",
    painPoints: "",
    tone: "",
    preferredChannels: "",
  });

  /* ── Derived ── */
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );
  const activeExperiment = useMemo<ExperimentRecord | null>(
    () => activeProject?.experiments.find((e) => e.id === activeExperimentId) ?? null,
    [activeProject, activeExperimentId]
  );
  const selectedPage = useMemo(
    () => (activeExperiment?.pageId ? activeProject?.pages.find((p) => p.id === activeExperiment.pageId) ?? null : null),
    [activeProject, activeExperiment]
  );
  const tests = useMemo<TestSuggestion[]>(
    () => activeExperiment?.tests ?? [],
    [activeExperiment]
  );
  const renders = useMemo<RenderRecord[]>(
    () => activeExperiment?.renders ?? [],
    [activeExperiment]
  );
  const personas = useMemo<PersonaRecord[]>(() => activeProject?.personas ?? [], [activeProject]);

  const canContinueToPersonas = selectedRenderIds.length > 0;
  const canRunTest = selectedRenderIds.length > 0 && selectedPersonaIds.length > 0;

  const workflowLoading = useMemo(() => {
    if (busyKey === "suggestTests")
      return {
        key: "suggestTests",
        title: "Generating treatment suggestions",
        detail: selectedPage ? `Analyzing ${selectedPage.route}...` : "Analyzing the selected page.",
      };
    if (busyKey === "implementTests")
      return {
        key: "implementTests",
        title: "Implementing treatments",
        detail: "Writing variants and rendering captures.",
      };
    if (busyKey === "runAttention")
      return {
        key: "runAttention",
        title: "Running persona flighting",
        detail: "Simulating attention and producing heatmap.",
      };
    if (busyKey === "pushPR")
      return {
        key: "pushPR",
        title: "Pushing treatment as PR",
        detail: "Re-implementing variant and creating pull request.",
      };
    return null;
  }, [busyKey, selectedPage]);

  const toggleProgressExpand = useCallback((id: string) => {
    setExpandedProgressIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ── Effects ── */
  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!api?.onProgress) return;
    const unsub = api.onProgress((event) => {
      setProgressLines((prev) => {
        const idx = prev.findIndex((l) => l.id === event.lineId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            label: event.label,
            status: event.status,
            tokens: updated[idx].tokens + event.tokenDelta,
            group: event.group ?? updated[idx].group,
          };
          return updated;
        }
        return [
          ...prev,
          { id: event.lineId, label: event.label, status: event.status, tokens: event.tokenDelta, group: event.group },
        ];
      });
    });
    return unsub;
  }, [api]);

  useEffect(() => {
    if (!api?.onProjectUpdated) return;
    const unsub = api.onProjectUpdated((project) => {
      setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)));
      if (project.status === "ready") {
        setProgressLines((prev) => prev.filter((l) => !l.group || l.group !== "Project setup"));
        setStatus(`"${project.name}" ready.`);
      }
    });
    return unsub;
  }, [api]);

  useEffect(() => {
    if (!activeProject) {
      setActiveExperimentId(null);
      setSelectedTestIds([]);
      setSelectedRenderIds([]);
      setSelectedPersonaIds([]);
      setAttention(null);
      setPagesStage("choose_page");
      return;
    }
    setActiveExperimentId((prev) =>
      prev && activeProject.experiments.some((e) => e.id === prev) ? prev : null
    );
    setSelectedPersonaIds((prev) => {
      if (prev.length > 0)
        return prev.filter((id) => activeProject.personas.some((p) => p.id === id));
      return activeProject.personas.slice(0, 2).map((p) => p.id);
    });
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject || !api) return;
    if (typeof api.refreshPages !== "function") return;
    const hasLegacyRoutes = activeProject.pages.some((p) => /\.(tsx?|jsx?|mdx)$/i.test(p.route));
    if (!hasLegacyRoutes) return;
    if (autoRefreshedProjectsRef.current.has(activeProject.id)) return;
    autoRefreshedProjectsRef.current.add(activeProject.id);
    void refreshPages();
  }, [activeProject, api]);

  /* ── API actions ── */
  async function bootstrap() {
    if (!api) {
      setError("Electron bridge unavailable. Start with `npm run dev`.");
      return;
    }
    try {
      const [p, s] = await Promise.all([api.listProjects(), api.getSettings()]);
      setProjects(unwrap(p));
      setSettings(unwrap(s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize.");
    }
  }

  async function refreshProjects() {
    if (!api) return;
    setProjects(unwrap(await api.listProjects()));
  }

  function hydrateSettingsForm(s: AppSettings | null) {
    setSuggestionModelInput(s?.suggestionModel || "inherit");
    setImplementationModelInput(s?.implementationModel || "inherit");
    setPersonasModelInput(s?.personasModel || "inherit");
    setAttentionModelInput(s?.attentionModel || "inherit");
  }

  async function openSettingsMenu() {
    if (!api) return;
    setError(null);
    try {
      const payload = unwrap(await api.getSettings());
      setSettings(payload);
      hydrateSettingsForm(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
      hydrateSettingsForm(settings);
    } finally {
      setClaudeApiKeyInput("");
      setShowSettings(true);
    }
  }

  async function addProject() {
    if (!api) return;
    setBusyKey("addProject");
    setStatus("Importing project...");
    setError(null);
    setProgressLines([]);
    setExpandedProgressIds(new Set());
    try {
      const project = unwrap(await api.addProject());
      setProjects((prev) => [project, ...prev.filter((i) => i.id !== project.id)]);
      setActiveProjectId(project.id);
      setActiveTab("experiments");
      setPagesStage("choose_page");
      setExpandedProjects((prev) => new Set(prev).add(project.id));
      setStatus(`Setting up "${project.name}"...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add project.";
      if (!/no project selected/i.test(msg)) {
        setError(msg);
      }
      setStatus("Ready");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeProject(projectId: string) {
    if (!api) return;
    setBusyKey(`remove-${projectId}`);
    setError(null);
    try {
      unwrap(await api.removeProject(projectId));
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (activeProjectId === projectId) setActiveProjectId(null);
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      setStatus("Project removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove project.");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveSettings() {
    if (!api) return;
    setBusyKey("saveApiKey");
    setError(null);
    try {
      const payload = unwrap(
        await api.updateSettings({
          claudeApiKey: claudeApiKeyInput.trim(),
          suggestionModel: suggestionModelInput,
          implementationModel: implementationModelInput,
          personasModel: personasModelInput,
          attentionModel: attentionModelInput,
        })
      );
      setSettings(payload);
      hydrateSettingsForm(payload);
      setClaudeApiKeyInput("");
      setShowSettings(false);
      setStatus(
        payload.hasClaudeApiKey
          ? payload.apiKeyStorage === "env"
            ? "API key loaded from .env or environment."
            : "API key saved."
          : "API key cleared."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setBusyKey(null);
    }
  }

  async function refreshPersonas() {
    if (!activeProject || !api) return;
    setBusyKey("refreshPersonas");
    setStatus("Generating personas...");
    setError(null);
    try {
      unwrap(await api.refreshPersonas(activeProject.id));
      await refreshProjects();
      setStatus("Personas refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh personas.");
    } finally {
      setBusyKey(null);
    }
  }

  async function refreshPages() {
    if (!activeProject || !api) return;
    if (typeof api.refreshPages !== "function") {
      setError("Restart Electron to use this feature.");
      return;
    }
    setBusyKey("refreshPages");
    setStatus("Re-rendering pages...");
    setError(null);
    try {
      const project = unwrap(await api.refreshPages(activeProject.id));
      setProjects((prev) => [project, ...prev.filter((i) => i.id !== project.id)]);
      setActiveProjectId(project.id);
      setStatus(`Re-rendered ${project.pages.length} pages.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-render pages.");
    } finally {
      setBusyKey(null);
    }
  }

  async function addCustomPersona() {
    if (!activeProject || !api) return;
    if (!personaDraft.name.trim() || !personaDraft.summary.trim()) {
      setError("Name and summary are required.");
      return;
    }
    setBusyKey("addPersona");
    setError(null);
    try {
      const personasPayload = unwrap(
        await api.addPersona(activeProject.id, {
          name: personaDraft.name.trim(),
          summary: personaDraft.summary.trim(),
          ageBand: personaDraft.ageBand.trim(),
          motivations: splitByComma(personaDraft.motivations),
          painPoints: splitByComma(personaDraft.painPoints),
          tone: personaDraft.tone.trim(),
          preferredChannels: splitByComma(personaDraft.preferredChannels),
        })
      );
      patchProject(activeProject.id, (p) => ({ ...p, personas: personasPayload }));
      setPersonaDraft({ name: "", summary: "", ageBand: "", motivations: "", painPoints: "", tone: "", preferredChannels: "" });
      setShowPersonaForm(false);
      setStatus("Persona added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add persona.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createExperiment() {
    if (!activeProject || !api) return;
    const name = newExperimentName.trim();
    if (!name) {
      setError("Experiment name is required.");
      return;
    }
    setBusyKey("createExperiment");
    setError(null);
    try {
      const project = unwrap(await api.createExperiment(activeProject.id, name));
      setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)));
      const created = project.experiments[project.experiments.length - 1];
      setActiveExperimentId(created.id);
      setPagesStage("choose_page");
      setNewExperimentName("");
      setShowNewExperimentForm(false);
      setStatus(`Experiment "${name}" created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create experiment.");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteExperiment(experimentId: string) {
    if (!activeProject || !api) return;
    setBusyKey(`deleteExp-${experimentId}`);
    setError(null);
    try {
      const project = unwrap(await api.deleteExperiment(activeProject.id, experimentId));
      setProjects((prev) => prev.map((p) => (p.id === project.id ? project : p)));
      if (activeExperimentId === experimentId) {
        setActiveExperimentId(null);
        setPagesStage("choose_page");
      }
      setStatus("Experiment deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete experiment.");
    } finally {
      setBusyKey(null);
    }
  }

  async function onSelectPage(pageId: string) {
    if (!activeProject || !activeExperiment || !api) return;
    patchProject(activeProject.id, (p) => ({
      ...p,
      experiments: p.experiments.map((e) =>
        e.id === activeExperiment.id ? { ...e, pageId } : e
      ),
    }));
    setGoalInput(activeExperiment.goal ?? "");
    setPagesStage("goal");
    setSelectedTestIds([]);
    setSelectedRenderIds([]);
    setAttention(null);
    try {
      await api.setExperimentPage(activeProject.id, activeExperiment.id, pageId);
    } catch {
      // local state already updated
    }
  }

  async function suggestPageTests() {
    if (!activeProject || !activeExperiment || !api) return;
    setBusyKey("suggestTests");
    setProgressLines([]);
    setExpandedProgressIds(new Set());
    setStatus(`Suggesting tests for ${selectedPage?.route ?? "page"}...`);
    setError(null);
    try {
      const testsPayload = unwrap(await api.suggestTests(activeProject.id, activeExperiment.id));
      patchProject(activeProject.id, (p) => ({
        ...p,
        experiments: p.experiments.map((e) =>
          e.id === activeExperiment.id ? { ...e, tests: testsPayload } : e
        ),
      }));
      setSelectedTestIds([]);
      setSelectedRenderIds([]);
      setAttention(null);
      setPagesStage("tests");
      setStatus(`${testsPayload.length} tests suggested.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suggest tests.");
    } finally {
      setBusyKey(null);
    }
  }

  async function implementSelectedTests() {
    if (!activeProject || !activeExperiment || !api || selectedTestIds.length === 0) return;
    setBusyKey("implementTests");
    setProgressLines([]);
    setExpandedProgressIds(new Set());
    setPagesStage("renders");
    setStatus("Implementing tests...");
    setError(null);
    try {
      const rendersPayload = unwrap(
        await api.implementTests(activeProject.id, activeExperiment.id, selectedTestIds)
      );
      patchProject(activeProject.id, (p) => ({
        ...p,
        experiments: p.experiments.map((e) =>
          e.id === activeExperiment.id ? { ...e, renders: rendersPayload } : e
        ),
      }));
      setSelectedRenderIds(rendersPayload.map((r) => r.id));
      setAttention(null);
      setPagesStage("renders");
      setStatus(`${rendersPayload.length} variants rendered.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to implement tests.");
    } finally {
      setBusyKey(null);
    }
  }

  async function runAttentionTest() {
    if (!activeProject || !activeExperiment || !api) return;
    if (selectedRenderIds.length === 0 || selectedPersonaIds.length === 0) {
      setError("Select at least one render and one persona.");
      return;
    }
    setBusyKey("runAttention");
    setProgressLines([]);
    setExpandedProgressIds(new Set());
    setStatus("Running attention analysis...");
    setError(null);
    try {
      const attentionPayload = unwrap(
        await api.runAttention(activeProject.id, activeExperiment.id, selectedRenderIds, selectedPersonaIds, visitorCount)
      );
      setAttention(attentionPayload);
      patchProject(activeProject.id, (project) => ({
        ...project,
        experiments: project.experiments.map((experiment) =>
          experiment.id === activeExperiment.id ? { ...experiment, attention: attentionPayload } : experiment
        ),
      }));
      // Initialize selectors from first available keys
      const firstHeatmapKey = Object.keys(attentionPayload.heatmaps)[0];
      if (firstHeatmapKey) {
        const [rId, pId] = firstHeatmapKey.split("__");
        setSelectedResultVariantId(rId);
        setSelectedResultPersonaId(pId);
      } else {
        const firstControlKey = Object.keys(attentionPayload.controlHeatmaps)[0];
        if (firstControlKey) setSelectedResultPersonaId(firstControlKey);
      }
      setPagesStage("results");
      setStatus("Heatmaps ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run attention analysis.");
    } finally {
      setBusyKey(null);
    }
  }

  async function pushRenderAsPR(renderId: string) {
    if (!activeProject || !activeExperiment || !api) return;
    setPushingPR(true);
    setBusyKey("pushPR");
    setProgressLines([]);
    setExpandedProgressIds(new Set());
    setStatus("Pushing treatment as PR...");
    setError(null);
    try {
      const result = unwrap(
        await api.pushRenderAsPR(activeProject.id, activeExperiment.id, renderId)
      );
      setStatus(`PR created: ${result.prUrl}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to push render as PR.");
    } finally {
      setPushingPR(false);
      setBusyKey(null);
    }
  }

  /* ── Helpers ── */
  function patchProject(projectId: string, updater: (p: ProjectRecord) => ProjectRecord) {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? updater(p) : p)));
  }

  function openProject(projectId: string) {
    setActiveProjectId(projectId);
    setActiveTab("experiments");
    setPagesStage("choose_page");
    setSelectedRenderIds([]);
    setSelectedTestIds([]);
    setActiveExperimentId(null);
    setAttention(null);
    setExpandedProjects((prev) => new Set(prev).add(projectId));
  }

  function handleProjectClick(projectId: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId) && activeProjectId === projectId) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
    if (activeProjectId !== projectId) openProject(projectId);
  }

  function selectTreeExperiment(projectId: string, experimentId: string) {
    if (activeProjectId !== projectId) {
      setActiveProjectId(projectId);
      setActiveTab("experiments");
      setSelectedRenderIds([]);
      setSelectedTestIds([]);
      setAttention(null);
    }
    setExpandedProjects((prev) => new Set(prev).add(projectId));
    setActiveExperimentId(experimentId);

    // Restore stage based on experiment progress
    const project = projects.find((p) => p.id === projectId);
    const experiment = project?.experiments.find((e) => e.id === experimentId);
    if (experiment?.attention) {
      setPagesStage("results");
      setAttention(experiment.attention);
      const firstKey = Object.keys(experiment.attention.heatmaps)[0];
      if (firstKey) {
        const [rId, pId] = firstKey.split("__");
        setSelectedResultVariantId(rId);
        setSelectedResultPersonaId(pId);
      }
    } else if (experiment?.renders.length) {
      setPagesStage("renders");
      setSelectedRenderIds(experiment.renders.map((r) => r.id));
    } else if (experiment?.tests.length) {
      setPagesStage("tests");
      setSelectedTestIds([]);
    } else if (experiment?.pageId && experiment?.goal) {
      setPagesStage("tests");
    } else if (experiment?.pageId) {
      setGoalInput(experiment.goal ?? "");
      setPagesStage("goal");
    } else {
      setPagesStage("choose_page");
    }
  }

  /* ═══ Render ═══════════════════════════════════════ */
  return (
    <div className="app">
      {/* ── Sidebar ── */}
      <aside
        className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}
        onMouseEnter={onSidebarEnter}
        onMouseLeave={onSidebarLeave}
      >
        <div className="sidebar-head">
          <div className="logo-group">
            <img src="mutatr_logo.png" alt="mutatr" className="logo-mark" />
            {sidebarOpen && <span className="logo-text">mutatr</span>}
          </div>
        </div>

        {sidebarOpen ? (
          <nav className="sidebar-tree">
            <span className="sidebar-label">Projects</span>
            {projects.map((project) => {
              const isExpanded = expandedProjects.has(project.id);
              const isActive = activeProjectId === project.id;
              return (
                <div key={project.id} className="tree-node">
                  <div className={`tree-root ${isActive ? "active" : ""}`}>
                    <button className="tree-root-btn" onClick={() => handleProjectClick(project.id)}>
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      {isExpanded ? <FolderOpen size={18} /> : <Folder size={18} />}
                      <span className="tree-label">{project.name}</span>
                      {project.status === "importing" && <span className="setup-badge">Setting up...</span>}
                    </button>
                    <button
                      className="tree-delete"
                      onClick={() => removeProject(project.id)}
                      disabled={busyKey === `remove-${project.id}`}
                      title="Remove project"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="tree-branch">
                      {project.experiments.map((experiment) => (
                        <button
                          key={experiment.id}
                          className={`tree-leaf ${activeExperimentId === experiment.id && isActive ? "active" : ""}`}
                          onClick={() => selectTreeExperiment(project.id, experiment.id)}
                        >
                          <FlaskConical size={16} />
                          <span>{experiment.name}</span>
                        </button>
                      ))}
                      {project.experiments.length === 0 && <span className="tree-empty">No experiments</span>}
                    </div>
                  )}
                </div>
              );
            })}
            {projects.length === 0 && <span className="tree-empty-root">No projects yet</span>}
          </nav>
        ) : (
          <nav className="sidebar-avatars">
            {projects.map((project) => (
              <button
                key={project.id}
                className={`project-avatar ${activeProjectId === project.id ? "active" : ""}`}
                onClick={() => {
                  openProject(project.id);
                }}
                title={project.name}
              >
                {project.name.charAt(0).toUpperCase()}
              </button>
            ))}
          </nav>
        )}

        <div className="sidebar-foot">
          <button className="sidebar-action" onClick={addProject} disabled={busyKey === "addProject"} title="New project">
            <Plus size={18} />
            {sidebarOpen && <span>{busyKey === "addProject" ? "Adding..." : "New project"}</span>}
          </button>
          <button className="sidebar-action" onClick={() => void openSettingsMenu()} title="Settings">
            <Settings2 size={18} />
            {sidebarOpen && <span>Settings</span>}
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button className={`bc-item bc-link ${!activeProject ? "current" : ""}`} onClick={() => { setActiveProjectId(null); setActiveExperimentId(null); }}>
              Projects
            </button>
            {activeProject && (
              <>
                <ChevronRight size={16} className="bc-sep" />
                <button
                  className={`bc-item bc-link ${!activeExperiment ? "current" : ""}`}
                  onClick={() => { setActiveExperimentId(null); setPagesStage("choose_page"); }}
                >
                  {activeProject.name}
                </button>
              </>
            )}
            {activeExperiment && (
              <>
                <ChevronRight size={16} className="bc-sep" />
                <span className="bc-item current">{activeExperiment.name}</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {!activeProject && (
              <Button variant="outline" size="sm" onClick={addProject} disabled={busyKey === "addProject"}>
                <Plus size={17} />
                {busyKey === "addProject" ? "Adding..." : "Add project"}
              </Button>
            )}
            {busyKey && <span className="status-badge">{status}</span>}
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <div className="content-scroll">
          {!activeProject ? (
            <div className="projects-overview">
              {projects.length === 0 ? (
                <div className="empty-state">No projects yet. Add one to get started.</div>
              ) : (
                <div className="project-grid">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className="project-card"
                      onClick={() => {
                        openProject(project.id);
                        setExpandedProjects((prev) => new Set(prev).add(project.id));
                      }}
                    >
                      <div className="project-card-icon">
                        <Folder size={24} />
                      </div>
                      <div className="project-card-body">
                        <span className="project-card-name">{project.name}</span>
                        <span className="project-card-meta">
                          {project.status === "importing"
                            ? "Setting up..."
                            : `${project.pages.length} pages · ${project.experiments.length} experiments · ${project.personas.length} personas`}
                        </span>
                      </div>
                      <button
                        className="project-card-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeProject(project.id);
                        }}
                        disabled={busyKey === `remove-${project.id}`}
                        title="Remove project"
                      >
                        <X size={17} />
                      </button>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeProject.status === "importing" ? (
            <ProgressPanel
              title={`Setting up "${activeProject.name}"`}
              detail="Discovering pages, generating personas, rendering thumbnails..."
              lines={progressLines}
              expandedIds={expandedProgressIds}
              onToggle={toggleProgressExpand}
            />
          ) : activeExperimentId && activeExperiment ? (
              /* ── Inside an experiment: workflow only, no tabs ── */
              <div>
                <div className="workflow-bar">
                  {WORKFLOW_STEPS.map((step, index) => {
                    const currentIndex = WORKFLOW_STEPS.findIndex((s) => s.id === pagesStage);
                    const isActive = index <= currentIndex;
                    const isClickable = index < currentIndex;
                    return (
                      <button
                        key={step.id}
                        className={`wf-step ${isActive ? "active" : ""} ${isClickable ? "clickable" : ""}`}
                        onClick={() => isClickable && setPagesStage(step.id)}
                        disabled={!isClickable}
                      >
                        <div className="wf-line" />
                        <span className="wf-label">{step.title}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Choose Page */}
                {pagesStage === "choose_page" && (
                  <section>
                    <div className="stage-head">
                      <h3>Choose a page for "{activeExperiment.name}"</h3>
                      <div className="actions-inline">
                        <span className="mono">{activeProject.pages.length} discovered</span>
                        <Button variant="outline" size="sm" onClick={refreshPages} disabled={busyKey === "refreshPages"}>
                          {busyKey === "refreshPages" ? "Rendering..." : "Re-render"}
                        </Button>
                      </div>
                    </div>
                    <div className="page-grid">
                      {activeProject.pages.map((page) => (
                        <button
                          type="button"
                          key={page.id}
                          className={`page-card ${activeExperiment.pageId === page.id ? "selected" : ""}`}
                          onClick={() => onSelectPage(page.id)}
                        >
                          {page.thumbnailDataUrl ? (
                            <img src={page.thumbnailDataUrl} alt={page.route} />
                          ) : (
                            <div className="thumb-fallback" />
                          )}
                          <span>{page.route}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Goal */}
                {selectedPage && pagesStage === "goal" && (
                  <section className="goal-stage">
                    <div className="goal-page-preview">
                      {selectedPage.thumbnailDataUrl ? (
                        <img src={selectedPage.thumbnailDataUrl} alt={selectedPage.route} className="goal-thumb" />
                      ) : (
                        <div className="thumb-fallback goal-thumb" />
                      )}
                      <span className="mono">{selectedPage.route}</span>
                    </div>
                    <div className="goal-form">
                      <h3>What's the goal for this page?</h3>
                      <p className="goal-hint">e.g. "Increase sign-ups", "Reduce bounce rate", "Improve CTA click-through"</p>
                      <textarea
                        className="goal-textarea"
                        placeholder="Describe the objective you want to optimize for..."
                        value={goalInput}
                        onChange={(e) => setGoalInput(e.target.value)}
                        rows={3}
                      />
                      <div className="stage-actions">
                        <Button
                          onClick={() => {
                            const goal = goalInput.trim() || null;
                            patchProject(activeProject.id, (p) => ({
                              ...p,
                              experiments: p.experiments.map((e) =>
                                e.id === activeExperiment.id ? { ...e, goal } : e
                              ),
                            }));
                            setPagesStage("tests");
                            api.setExperimentGoal(activeProject.id, activeExperiment.id, goal).catch(() => {});
                            suggestPageTests();
                          }}
                        >
                          Continue
                        </Button>
                      </div>
                    </div>
                  </section>
                )}

                {/* Tests */}
                {selectedPage && pagesStage === "tests" && (
                  <section>
                    <div className="stage-head">
                      <h3>Treatments for {selectedPage.route}</h3>
                      {tests.length > 0 && (
                        <Button variant="outline" size="sm" onClick={suggestPageTests} disabled={busyKey === "suggestTests"}>
                          {busyKey === "suggestTests" ? "Suggesting..." : "Re-suggest"}
                        </Button>
                      )}
                    </div>
                    {workflowLoading?.key === "suggestTests" ? (
                      <ProgressPanel title={workflowLoading.title} detail={workflowLoading.detail} lines={progressLines} expandedIds={expandedProgressIds} onToggle={toggleProgressExpand} />
                    ) : (
                      <>
                        <div className="test-list">
                          {tests.length === 0 && !workflowLoading && <div className="empty-state">No treatments yet.</div>}
                          {tests.map((test) => {
                            const checked = selectedTestIds.includes(test.id);
                            return (
                              <label key={test.id} className="test-item">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setSelectedTestIds((prev) =>
                                      e.target.checked ? [...prev, test.id] : prev.filter((id) => id !== test.id)
                                    )
                                  }
                                />
                                <div>
                                  <div className="test-title">
                                    {test.title}
                                    <Badge
                                      variant={
                                        test.riskLevel === "high"
                                          ? "destructive"
                                          : test.riskLevel === "medium"
                                            ? "secondary"
                                            : "outline"
                                      }
                                      className={`risk ${test.riskLevel}`}
                                    >
                                      {test.riskLevel}
                                    </Badge>
                                  </div>
                                  <p>{test.hypothesis}</p>
                                  <small>{test.expectedImpact}</small>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                        {tests.length > 0 && (
                          <div className="stage-actions">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setSelectedTestIds((prev) =>
                                  prev.length === tests.length ? [] : tests.map((t) => t.id)
                                )
                              }
                            >
                              {selectedTestIds.length === tests.length ? "Deselect all" : "Select all"}
                            </Button>
                            <Button
                              onClick={implementSelectedTests}
                              disabled={selectedTestIds.length === 0 || busyKey === "implementTests"}
                            >
                              {busyKey === "implementTests" ? "Implementing..." : "Implement selected"}
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )}

                {/* Renders */}
                {selectedPage && pagesStage === "renders" && (
                  <section>
                    <div className="stage-head">
                      <h3>Variant renders</h3>
                      <span className="mono">{renders.length} variants</span>
                    </div>
                    {workflowLoading?.key === "implementTests" ? (
                      <ProgressPanel title={workflowLoading.title} detail={workflowLoading.detail} lines={progressLines} expandedIds={expandedProgressIds} onToggle={toggleProgressExpand} />
                    ) : (
                      <>
                        <div className="render-grid">
                          {renders.length === 0 && (
                            <div className="empty-state">Implement tests to generate variants.</div>
                          )}
                          {renders.map((render) => {
                            const checked = selectedRenderIds.includes(render.id);
                            return (
                              <label key={render.id} className={`render-card ${checked ? "selected" : ""}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setSelectedRenderIds((prev) =>
                                      e.target.checked ? [...prev, render.id] : prev.filter((id) => id !== render.id)
                                    )
                                  }
                                />
                                {render.screenshotDataUrl ? (
                                  <img src={render.screenshotDataUrl} alt={render.title} />
                                ) : (
                                  <div className="thumb-fallback" />
                                )}
                                <span>{render.title}</span>
                                {render.errorMessage ? (
                                  <small className="render-card-error" title={render.errorMessage}>
                                    {render.errorMessage}
                                  </small>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                        <div className="stage-actions">
                          <Button
                            onClick={() => {
                              setPagesStage("personas");
                              setStatus("Select personas, then run the test.");
                            }}
                            disabled={!canContinueToPersonas}
                          >
                            Test selected renders
                          </Button>
                        </div>
                      </>
                    )}
                  </section>
                )}

                {/* Personas selection */}
                {selectedPage && pagesStage === "personas" && (
                  <section>
                    <div className="stage-head">
                      <h3>Select personas</h3>
                      <span className="mono">{selectedPersonaIds.length} selected</span>
                    </div>
                    {workflowLoading?.key === "runAttention" ? (
                      <ProgressPanel title={workflowLoading.title} detail={workflowLoading.detail} lines={progressLines} expandedIds={expandedProgressIds} onToggle={toggleProgressExpand} />
                    ) : (
                      <>
                        <div className="visitor-count-bar">
                          <div className="visitor-count-row">
                            <label className="visitor-count-label">Visitors per pair</label>
                            <Input
                              type="number"
                              className="visitor-count-input"
                              min={1}
                              max={50}
                              value={visitorCount}
                              onChange={(e) => setVisitorCount(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                            <span className="mono">
                              {visitorCount} visitors &times; {selectedRenderIds.length + 1} variants &times; {selectedPersonaIds.length} personas
                            </span>
                          </div>
                          <Button onClick={runAttentionTest} disabled={!canRunTest || busyKey === "runAttention"}>
                            {busyKey === "runAttention" ? "Testing..." : "Run test"}
                          </Button>
                        </div>
                        <div className="persona-select-grid">
                          {personas.map((persona) => {
                            const checked = selectedPersonaIds.includes(persona.id);
                            return (
                              <label key={persona.id} className={`persona-select-card ${checked ? "selected" : ""}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setSelectedPersonaIds((prev) =>
                                      e.target.checked ? [...prev, persona.id] : prev.filter((id) => id !== persona.id)
                                    )
                                  }
                                />
                                <h3>{persona.name}</h3>
                                <p>{persona.summary}</p>
                                <div className="meta-line">{persona.ageBand} &middot; {persona.tone}</div>
                                <div className="chip-row">
                                  {persona.motivations.map((m) => (
                                    <span key={m}>{m}</span>
                                  ))}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </section>
                )}

                {/* Results */}
                {selectedPage && pagesStage === "results" && (
                  <section>
                    <div className="stage-head">
                      <h3>Attention heatmaps</h3>
                      <span className="mono">
                        {selectedRenderIds.length} renders &times; {selectedPersonaIds.length} personas
                      </span>
                    </div>
                    {attention && Object.keys(attention.heatmaps).length > 0 ? (() => {
                      const testedRenders = renders.filter((r) =>
                        Object.keys(attention.heatmaps).some((k) => k.startsWith(r.id + "__"))
                      );
                      const testedPersonaIds = [...new Set(
                        Object.keys(attention.heatmaps).map((k) => k.split("__")[1])
                      )];
                      const testedPersonas = personas.filter((p) => testedPersonaIds.includes(p.id));

                      const activeVariantId = selectedResultVariantId ?? testedRenders[0]?.id;
                      const activePersonaId = selectedResultPersonaId ?? testedPersonas[0]?.id;

                      const variantKey = activeVariantId && activePersonaId ? `${activeVariantId}__${activePersonaId}` : null;
                      const variantHeatmap = variantKey ? (attention.heatmaps[variantKey] as AttentionPayload | undefined) : undefined;
                      const controlHeatmap = activePersonaId ? (attention.controlHeatmaps[activePersonaId] as AttentionPayload | undefined) : undefined;
                      const variantSummary = activeVariantId ? attention.variantSummaries?.[activeVariantId] : undefined;
                      const activeScorecard = variantHeatmap?.scorecard;
                      const personaScoreRows = activeVariantId
                        ? testedPersonas.map((persona) => ({
                            persona,
                            scorecard: attention.heatmaps[`${activeVariantId}__${persona.id}`]?.scorecard,
                          })).filter((row) => row.scorecard)
                        : [];

                      return (
                        <div className="comparison-layout">
                          <div className="variant-overview-grid">
                            {testedRenders.map((render) => {
                              const summary = attention.variantSummaries?.[render.id];
                              return (
                                <button
                                  key={render.id}
                                  className={`variant-overview-card ${activeVariantId === render.id ? "active" : ""}`}
                                  onClick={() => setSelectedResultVariantId(render.id)}
                                >
                                  <div className="variant-overview-head">
                                    <span className="variant-overview-title">{render.title}</span>
                                    <span className="variant-overview-score">{summary?.overallScore ?? "--"}</span>
                                  </div>
                                  <div className="variant-overview-meta">
                                    <span>{summary ? `${formatSignedScore(summary.averageDeltaFromControl)} vs control` : "No aggregate yet"}</span>
                                    <span>{summary ? `${summary.consistencyScore} consistency` : ""}</span>
                                  </div>
                                  {summary?.summary && <p>{summary.summary}</p>}
                                </button>
                              );
                            })}
                          </div>

                          <div className="variant-selector">
                            <div className="variant-tabs">
                              {testedRenders.map((r) => (
                                <button
                                  key={r.id}
                                  className={`variant-tab ${activeVariantId === r.id ? "active" : ""}`}
                                  onClick={() => setSelectedResultVariantId(r.id)}
                                >
                                  {selectedPage.route}: {r.title}
                                </button>
                              ))}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={pushingPR || !activeVariantId}
                              onClick={() => activeVariantId && pushRenderAsPR(activeVariantId)}
                            >
                              {pushingPR ? "Pushing..." : "Push as PR"}
                            </Button>
                          </div>

                          <div className="comparison-body">
                            <div className="persona-sidebar">
                              {testedPersonas.map((p) => (
                                <button
                                  key={p.id}
                                  className={`persona-side-item ${activePersonaId === p.id ? "active" : ""}`}
                                  onClick={() => setSelectedResultPersonaId(p.id)}
                                >
                                  {p.name}
                                </button>
                              ))}
                            </div>

                            <div className="comparison-center">
                              <div className="comparison-labels">
                                <span>Control</span>
                                <span>Variant</span>
                              </div>
                              <div className="comparison-slider-container">
                                {/* Variant layer (full, behind) */}
                                {variantHeatmap?.heatmapDataUrl ? (
                                  <img src={variantHeatmap.heatmapDataUrl} alt="Variant heatmap" className="comparison-base-img" />
                                ) : (
                                  <div className="thumb-fallback comparison-base-img" />
                                )}
                                {/* Control layer (overlaid, clipped from right) */}
                                {controlHeatmap?.heatmapDataUrl && (
                                  <img
                                    src={controlHeatmap.heatmapDataUrl}
                                    alt="Control heatmap"
                                    className="comparison-clip-img"
                                    style={{ clipPath: `inset(0 ${100 - comparisonSliderPos}% 0 0)` }}
                                  />
                                )}
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  value={comparisonSliderPos}
                                  onChange={(e) => setComparisonSliderPos(Number(e.target.value))}
                                  className="comparison-slider"
                                />
                                <div className="comparison-handle" style={{ left: `${comparisonSliderPos}%` }} />
                              </div>

                              <div className="comparison-rationale">
                                {controlHeatmap?.rationale && (
                                  <div>
                                    <strong>Control:</strong>
                                    <p>{controlHeatmap.rationale}</p>
                                  </div>
                                )}
                                {variantHeatmap?.rationale && (
                                  <div>
                                    <strong>Variant:</strong>
                                    <p>{variantHeatmap.rationale}</p>
                                  </div>
                                )}
                              </div>

                              {activeScorecard && (
                                <div className="scorecard-stack">
                                  <Card className="scorecard-hero">
                                    <CardHeader>
                                      <div className="scorecard-hero-head">
                                        <div>
                                          <div className="scorecard-kicker">Variant x Persona</div>
                                          <CardTitle>{activeVariantId && renders.find((render) => render.id === activeVariantId)?.title} · {activePersonaId && personas.find((persona) => persona.id === activePersonaId)?.name}</CardTitle>
                                        </div>
                                        <Badge className={`score-badge ${verdictTone(activeScorecard.verdict)}`}>
                                          {activeScorecard.verdict}
                                        </Badge>
                                      </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="scorecard-topline">
                                          <div className="score-pillar">
                                            <span>Overall</span>
                                            <strong>{activeScorecard.overallScore}</strong>
                                        </div>
                                        <div className="score-pillar">
                                          <span>Delta vs control</span>
                                          <strong>{formatSignedScore(activeScorecard.deltaFromControl)}</strong>
                                        </div>
                                        <div className="score-pillar">
                                          <span>Confidence</span>
                                          <strong>{activeScorecard.confidenceScore}</strong>
                                          </div>
                                          <div className="score-pillar">
                                            <span>Confidence mode</span>
                                            <strong>{activeScorecard.confidenceLabel}</strong>
                                          </div>
                                          <div className="score-pillar">
                                            <span>Goal fit</span>
                                            <strong>{activeScorecard.goalAlignment?.score ?? "--"}</strong>
                                          </div>
                                        </div>
                                      <p className="scorecard-summary">{activeScorecard.summary}</p>
                                      <p className="scorecard-diff">{activeScorecard.diffSummary}</p>
                                    </CardContent>
                                  </Card>

                                  {variantSummary && (
                                    <Card className="aggregate-scorecard">
                                      <CardHeader>
                                        <CardTitle>Variant aggregate</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <div className="aggregate-pills">
                                          <span>{variantSummary.overallScore} overall</span>
                                          <span>{formatSignedScore(variantSummary.averageDeltaFromControl)} vs control</span>
                                          <span>{variantSummary.consistencyScore} consistency</span>
                                          <span>{variantSummary.goalAlignment?.score ?? "--"} goal fit</span>
                                        </div>
                                        <p className="scorecard-summary">{variantSummary.summary}</p>
                                        <p className="scorecard-diff">{variantSummary.goalAlignment?.summary}</p>
                                        {(variantSummary.goalAlignment?.priorityMetrics?.length ?? 0) > 0 && (
                                          <div className="goal-chip-row">
                                            {variantSummary.goalAlignment.priorityMetrics.map((metricKey) => (
                                              <span key={metricKey} className="goal-chip">{metricTitle(metricKey)}</span>
                                            ))}
                                          </div>
                                        )}
                                        <div className="aggregate-mini-grid">
                                          <div className="aggregate-mini-card">
                                            <div className="scorecard-kicker">Recurring issues</div>
                                            <p>
                                              {variantSummary.issues?.length
                                                ? variantSummary.issues.slice(0, 2).map((issue) => issue.title).join(" · ")
                                                : "No recurring issues surfaced across personas."}
                                            </p>
                                          </div>
                                          <div className="aggregate-mini-card">
                                            <div className="scorecard-kicker">Common shifts</div>
                                            <p>
                                              {variantSummary.diff?.changes?.length
                                                ? variantSummary.diff.changes.slice(0, 2).map((change) => change.title).join(" · ")
                                                : "No dominant change pattern yet."}
                                            </p>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  )}

                                  <div className="metric-card-grid">
                                    {SCORE_METRICS.map((metric) => {
                                      const item = activeScorecard.metrics[metric.key];
                                      return (
                                        <Card key={metric.key} className="metric-card">
                                          <CardContent>
                                            <div className="metric-head">
                                              <span>{metric.label}</span>
                                              <strong>{item.score}</strong>
                                            </div>
                                            <div className="metric-bar">
                                              <div className="metric-bar-fill" style={{ width: `${item.score}%` }} />
                                            </div>
                                            <div className={`metric-delta ${item.deltaFromControl >= 0 ? "positive" : "negative"}`}>
                                              {formatSignedScore(item.deltaFromControl)} vs control
                                            </div>
                                            <p>{item.rationale}</p>
                                          </CardContent>
                                        </Card>
                                      );
                                    })}
                                  </div>

                                  <div className="scorecard-columns">
                                    <Card className="scorecard-column">
                                      <CardHeader>
                                        <CardTitle>Strengths</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <ul className="score-list">
                                          {activeScorecard.strengths.map((item) => (
                                            <li key={item}>{item}</li>
                                          ))}
                                        </ul>
                                      </CardContent>
                                    </Card>

                                    <Card className="scorecard-column">
                                      <CardHeader>
                                        <CardTitle>Risks</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <ul className="score-list">
                                          {activeScorecard.risks.map((item) => (
                                            <li key={item}>{item}</li>
                                          ))}
                                        </ul>
                                      </CardContent>
                                    </Card>

                                    <Card className="scorecard-column">
                                      <CardHeader>
                                        <CardTitle>Recommendations</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <ul className="score-list">
                                          {activeScorecard.recommendations.map((item) => (
                                            <li key={item}>{item}</li>
                                          ))}
                                        </ul>
                                      </CardContent>
                                    </Card>
                                  </div>

                                  <div className="scorecard-columns">
                                    <Card className="scorecard-column">
                                      <CardHeader>
                                        <CardTitle>Goal Focus</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <div className="goal-focus-score">
                                          <strong>{activeScorecard.goalAlignment?.score ?? "--"}</strong>
                                          <span>{formatSignedScore(activeScorecard.goalAlignment?.deltaFromControl ?? 0)} vs control</span>
                                        </div>
                                        <p className="scorecard-summary">{activeScorecard.goalAlignment?.summary ?? "No explicit goal weighting is available for this result."}</p>
                                        {(activeScorecard.goalAlignment?.priorityMetrics?.length ?? 0) > 0 && (
                                          <div className="goal-chip-row">
                                            {activeScorecard.goalAlignment?.priorityMetrics?.map((metricKey) => (
                                              <span key={metricKey} className="goal-chip">{metricTitle(metricKey)}</span>
                                            ))}
                                          </div>
                                        )}
                                      </CardContent>
                                    </Card>

                                    <Card className="scorecard-column">
                                      <CardHeader>
                                        <CardTitle>Issue Detector</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <div className="issue-stack">
                                          {(activeScorecard.issues ?? []).length > 0 ? (
                                            (activeScorecard.issues ?? []).map((issue) => (
                                              <div key={issue.title} className="issue-card">
                                                <div className="issue-card-head">
                                                  <strong>{issue.title}</strong>
                                                  <Badge className={`score-badge ${issueTone(issue.severity)}`}>
                                                    {issue.severity}
                                                  </Badge>
                                                </div>
                                                <p>{issue.description}</p>
                                                <span>
                                                  {issue.metricKey ? `${metricTitle(issue.metricKey)}: ` : ""}
                                                  {issue.recommendation}
                                                </span>
                                              </div>
                                            ))
                                          ) : (
                                            <p className="scorecard-summary">No concrete issues were detected for this tuple beyond the score deltas.</p>
                                          )}
                                        </div>
                                      </CardContent>
                                    </Card>

                                    <Card className="scorecard-column">
                                      <CardHeader>
                                        <CardTitle>Diff Explainer</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <p className="scorecard-summary">{activeScorecard.diff?.summary ?? "No structured diff explanation is available for this result."}</p>
                                        <p className="scorecard-diff">{activeScorecard.diff?.likelyImpact ?? ""}</p>
                                        <div className="diff-change-stack">
                                          {(activeScorecard.diff?.changes ?? []).length > 0 ? (
                                            (activeScorecard.diff?.changes ?? []).map((change) => (
                                              <div key={change.title} className="diff-change-card">
                                                <div className="issue-card-head">
                                                  <strong>{change.title}</strong>
                                                  <Badge className={`score-badge ${impactTone(change.impact)}`}>
                                                    {change.impact}
                                                  </Badge>
                                                </div>
                                                <p>{change.description}</p>
                                              </div>
                                            ))
                                          ) : (
                                            <p className="scorecard-summary">No dominant visual change pattern was extracted for this tuple.</p>
                                          )}
                                        </div>
                                      </CardContent>
                                    </Card>
                                  </div>

                                  <div className="scorecard-columns">
                                    <Card className="scorecard-column">
                                      <CardHeader>
                                        <CardTitle>Evidence Mix</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <div className="evidence-stack">
                                          {Object.entries(activeScorecard.evidenceMix).map(([key, value]) => (
                                            <div key={key} className="evidence-row">
                                              <div className="evidence-label">
                                                <span>{key}</span>
                                                <strong>{value}</strong>
                                              </div>
                                              <div className="metric-bar">
                                                <div className="metric-bar-fill" style={{ width: `${value}%` }} />
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </CardContent>
                                    </Card>

                                    <Card className="scorecard-column scorecard-wide">
                                      <CardHeader>
                                        <CardTitle>Persona Spread</CardTitle>
                                      </CardHeader>
                                      <CardContent>
                                        <div className="persona-score-table">
                                          {personaScoreRows.map((row) => (
                                            <div key={row.persona.id} className={`persona-score-row ${row.persona.id === activePersonaId ? "active" : ""}`}>
                                              <div>
                                                <strong>{row.persona.name}</strong>
                                                <span>{row.scorecard?.verdict ?? "mixed"}</span>
                                              </div>
                                              <div>
                                                <strong>{row.scorecard?.overallScore ?? "--"}</strong>
                                                <span>{formatSignedScore(row.scorecard?.deltaFromControl ?? 0)}</span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </CardContent>
                                    </Card>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="empty-state">Run a persona flight to generate heatmaps.</div>
                    )}
                  </section>
                )}
              </div>
          ) : (
            <>
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
                <TabsList>
                  <TabsTrigger value="experiments">Experiments</TabsTrigger>
                  <TabsTrigger value="personas">Personas</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* ── Experiments Tab ── */}
              {activeTab === "experiments" && !activeExperimentId && (
                <div className="tab-content-sep">
                  <div className="stage-head">
                    <div />
                    <div className="actions-inline">
                      <span className="mono">{activeProject.experiments.length} experiments</span>
                      <Button variant="outline" size="sm" onClick={() => setShowNewExperimentForm((v) => !v)}>
                        <Plus size={17} /> New experiment
                      </Button>
                    </div>
                  </div>


                  <div className="experiment-list">
                    {activeProject.experiments.length === 0 && (
                      <div className="empty-state">No experiments yet. Create one to get started.</div>
                    )}
                    {activeProject.experiments.map((experiment) => {
                      const page = experiment.pageId
                        ? activeProject.pages.find((p) => p.id === experiment.pageId)
                        : null;
                      return (
                        <div key={experiment.id} className="experiment-card" onClick={() => selectTreeExperiment(activeProject.id, experiment.id)}>
                          <div className="experiment-card-header">
                            <FlaskConical size={18} />
                            <span>{experiment.name}</span>
                            <button
                              className="tree-delete"
                              style={{ position: "static", opacity: 1 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteExperiment(experiment.id);
                              }}
                              title="Delete experiment"
                            >
                              <X size={16} />
                            </button>
                          </div>
                          <div className="experiment-card-meta">
                            {page ? page.route : "No page selected"}
                            {" · "}
                            {experiment.tests.length} tests
                            {" · "}
                            {experiment.renders.length} renders
                            {experiment.attention ? " · Has results" : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Personas Tab ── */}
              {activeTab === "personas" && (
                <div className="tab-content-sep">
                  <div className="stage-head">
                    <div className="actions-inline">
                      <Button variant="outline" size="sm" onClick={refreshPersonas} disabled={busyKey === "refreshPersonas"}>
                        <Sparkles size={17} />
                        {busyKey === "refreshPersonas" ? "Generating..." : "Generate with AI"}
                      </Button>
                    </div>
                    <div className="actions-inline">
                      <span className="mono">{personas.length} personas</span>
                      <Button variant="outline" size="sm" onClick={() => setShowPersonaForm((v) => !v)}>
                        <Plus size={17} /> New persona
                      </Button>
                    </div>
                  </div>


                  <div className="persona-grid">
                    {personas.map((persona) => (
                      <article key={persona.id} className="persona-card">
                        <h3>{persona.name}</h3>
                        <p>{persona.summary}</p>
                        <div className="meta-line">
                          {persona.ageBand} &middot; {persona.tone}
                        </div>
                        <div className="chip-row">
                          {persona.motivations.map((m) => (
                            <span key={m}>{m}</span>
                          ))}
                        </div>
                        <div className="chip-row muted">
                          {persona.painPoints.map((p) => (
                            <span key={p}>{p}</span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ── Settings Dialog ── */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              API key: {settings?.hasClaudeApiKey ? `configured (${settings.maskedClaudeApiKey})` : "not set"}
              {settings?.hasClaudeApiKey && settings.apiKeyStorage === "env" ? " · loaded from .env / environment" : ""}
              {settings?.hasClaudeApiKey && settings.apiKeyStorage === "plaintext" ? " · stored in app state" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="settings-grid">
            <label className="settings-field">
              <span>Claude API Key</span>
              <Input type="password" placeholder="sk-ant-..." value={claudeApiKeyInput} onChange={(e) => setClaudeApiKeyInput(e.target.value)} />
            </label>
            <label className="settings-field">
              <span>Personas model</span>
              <select className="model-select" value={personasModelInput} onChange={(e) => setPersonasModelInput(e.target.value)}>
                {PERSONAS_MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="settings-field">
              <span>Suggestions model</span>
              <select className="model-select" value={suggestionModelInput} onChange={(e) => setSuggestionModelInput(e.target.value)}>
                {SUGGESTION_MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="settings-field">
              <span>Implementation model</span>
              <select className="model-select" value={implementationModelInput} onChange={(e) => setImplementationModelInput(e.target.value)}>
                {IMPLEMENTATION_MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="settings-field">
              <span>Attention model</span>
              <select className="model-select" value={attentionModelInput} onChange={(e) => setAttentionModelInput(e.target.value)}>
                {ATTENTION_MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave empty to clear. Keys are encrypted locally when secure OS storage is available; otherwise they remain in memory for the current session only.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button>
            <Button onClick={saveSettings} disabled={busyKey === "saveApiKey"}>
              {busyKey === "saveApiKey" ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Experiment Dialog ── */}
      <Dialog open={showNewExperimentForm} onOpenChange={setShowNewExperimentForm}>
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>New experiment</DialogTitle>
            <DialogDescription>Give your experiment a name to get started.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Experiment name"
            value={newExperimentName}
            onChange={(e) => setNewExperimentName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createExperiment()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewExperimentForm(false)}>Cancel</Button>
            <Button onClick={createExperiment} disabled={busyKey === "createExperiment"}>
              {busyKey === "createExperiment" ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Persona Dialog ── */}
      <Dialog open={showPersonaForm} onOpenChange={setShowPersonaForm}>
        <DialogContent className="modal">
          <DialogHeader>
            <DialogTitle>Add persona</DialogTitle>
            <DialogDescription>Define a synthetic persona for testing.</DialogDescription>
          </DialogHeader>
          <div className="settings-grid">
            <Input placeholder="Name" value={personaDraft.name} onChange={(e) => setPersonaDraft((d) => ({ ...d, name: e.target.value }))} />
            <Input placeholder="Summary" value={personaDraft.summary} onChange={(e) => setPersonaDraft((d) => ({ ...d, summary: e.target.value }))} />
            <Input placeholder="Age band" value={personaDraft.ageBand} onChange={(e) => setPersonaDraft((d) => ({ ...d, ageBand: e.target.value }))} />
            <Input placeholder="Motivations (comma sep)" value={personaDraft.motivations} onChange={(e) => setPersonaDraft((d) => ({ ...d, motivations: e.target.value }))} />
            <Input placeholder="Pain points (comma sep)" value={personaDraft.painPoints} onChange={(e) => setPersonaDraft((d) => ({ ...d, painPoints: e.target.value }))} />
            <Input placeholder="Tone" value={personaDraft.tone} onChange={(e) => setPersonaDraft((d) => ({ ...d, tone: e.target.value }))} />
            <Input placeholder="Channels (comma sep)" value={personaDraft.preferredChannels} onChange={(e) => setPersonaDraft((d) => ({ ...d, preferredChannels: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPersonaForm(false)}>Cancel</Button>
            <Button onClick={addCustomPersona} disabled={busyKey === "addPersona"}>
              {busyKey === "addPersona" ? "Saving..." : "Save persona"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function splitByComma(input: string) {
  return input.split(",").map((s) => s.trim()).filter(Boolean);
}
