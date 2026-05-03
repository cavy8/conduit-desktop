import { useEffect, useState } from "react";
import { useAiStore, type EngineType } from "../../stores/aiStore";
import { invoke } from "../../lib/electron";
import EngineLogo from "./EngineLogo";
import { RefreshIcon } from "../../lib/icons";

interface EngineOption {
  type: EngineType;
  name: string;
  description: string;
  cli: string;
}

const ENGINE_OPTIONS: EngineOption[] = [
  {
    type: "claude-code",
    name: "Claude Code",
    description: "Anthropic's coding agent. Uses your Claude subscription.",
    cli: "claude",
  },
  {
    type: "codex",
    name: "Codex",
    description: "OpenAI's coding agent. Uses your ChatGPT or API plan.",
    cli: "codex",
  },
];

interface Props {
  /** Called after the choice is persisted and setActiveEngine has run.
   *  Caller decides what to do next (e.g. createEngineSession in chat mode,
   *  or signal the terminal-mode launch effect to fire). */
  onPick: (type: EngineType) => Promise<void> | void;
}

export default function EnginePicker({ onPick }: Props) {
  const engineAvailability = useAiStore((s) => s.engineAvailability);
  const checkEngineAvailability = useAiStore((s) => s.checkEngineAvailability);
  const setActiveEngine = useAiStore((s) => s.setActiveEngine);
  const lastChosen = useAiStore((s) => s.activeEngineType);

  const [busy, setBusy] = useState<EngineType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkEngineAvailability();
  }, [checkEngineAvailability]);

  const handlePick = async (type: EngineType) => {
    setBusy(type);
    setError(null);
    try {
      // Persist the choice and mark the picker as completed so it never shows
      // again automatically — user can change engine in Settings → AI → Agent.
      const current = await invoke<Record<string, unknown>>("settings_get");
      await invoke("settings_save", {
        settings: {
          ...current,
          default_engine: type,
          engine_picker_completed: true,
        },
      });
      // Set as active. setActiveEngine clears any leftover session state.
      setActiveEngine(type);
      // Hand off to the caller — chat mode opens a session, terminal mode
      // flips the launch gate.
      await onPick(type);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleInstall = async (type: EngineType) => {
    try {
      await invoke("engine_open_install_docs", { engineType: type });
    } catch {
      /* non-critical */
    }
  };

  return (
    <div className="flex items-center justify-center h-full px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-5">
          <p className="text-ink font-medium mb-1">Choose your AI agent</p>
          <p className="text-xs text-ink-faint">
            Conduit uses your local CLI agent. Pick which one to use — you can change this any time in Settings &gt; AI &gt; Agent.
          </p>
        </div>

        <div className="space-y-2 mb-4">
          {ENGINE_OPTIONS.map((opt) => {
            const available = engineAvailability?.[opt.type] ?? false;
            const isLast = lastChosen === opt.type;
            const isBusy = busy === opt.type;

            return (
              <div
                key={opt.type}
                className={`bg-well border rounded-lg p-3 transition-colors ${
                  isLast ? "border-conduit-500/60" : "border-stroke"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-md bg-panel flex items-center justify-center flex-shrink-0 mt-0.5">
                    <EngineLogo type={opt.type} size={18} className="text-ink" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-ink">{opt.name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          available
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-amber-500/15 text-amber-400"
                        }`}
                      >
                        {available ? "Installed" : "Not installed"}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted mb-2">{opt.description}</p>
                    {available ? (
                      <button
                        onClick={() => handlePick(opt.type)}
                        disabled={isBusy || busy !== null}
                        className="px-3 py-1.5 bg-conduit-600 hover:bg-conduit-700 disabled:opacity-50 text-white rounded text-xs font-medium"
                      >
                        {isBusy ? "Starting…" : `Use ${opt.name}`}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleInstall(opt.type)}
                        className="px-3 py-1.5 bg-panel hover:bg-raised border border-stroke text-ink-muted hover:text-ink rounded text-xs font-medium"
                      >
                        Install instructions
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="text-xs text-red-400 mb-3 text-center">{error}</p>
        )}

        <div className="flex justify-center">
          <button
            onClick={() => checkEngineAvailability()}
            className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink-muted"
          >
            <RefreshIcon size={12} />
            Re-check availability
          </button>
        </div>
      </div>
    </div>
  );
}
