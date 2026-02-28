import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getStoredUser, clearAuth, isLoggedIn } from "../../services/api";
import { loadPipeline, getDefaultPipeline, type PipelineRound } from "../../services/pipeline";
import { Card, SectionLabel, Divider } from "../../assets/components/shared/Card";
import { Btn } from "../../assets/components/shared/Btn";
import { Tag } from "../../assets/components/shared/Badges";
import { Avatar } from "../../assets/components/shared/Avatar";

/* ------------------------------------------------------------------ */
/*  Types & defaults                                                   */
/* ------------------------------------------------------------------ */
const DEFAULT_SKILLS = ["JavaScript", "React", "Node.js", "Python", "SQL"];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function CandidateProfile() {
  const navigate = useNavigate();
  const loggedIn = isLoggedIn();
  const user = getStoredUser();

  const name = typeof user?.name === "string" ? user.name : "Candidate";
  const email = typeof user?.email === "string" ? user.email : "";
  const role = typeof user?.role === "string" ? user.role : "Job Seeker";
  const initials = name
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  /* Photo state */
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setPhotoUrl(url);
    }
  };

  /* Skills state (editable) */
  const [skills, setSkills] = useState<string[]>(DEFAULT_SKILLS);
  const [newSkill, setNewSkill] = useState("");
  const addSkill = () => {
    const trimmed = newSkill.trim();
    if (trimmed && !skills.includes(trimmed) && skills.length < 5) {
      setSkills([...skills, trimmed]);
      setNewSkill("");
    }
  };
  const removeSkill = (s: string) => setSkills(skills.filter((x) => x !== s));

  /* Resume state */
  const resumeRef = useRef<HTMLInputElement>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  const handleResume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setResumeFile(file);
  };

  /* Pipeline progress (persisted in localStorage) */
  const [pipeline, setPipeline] = useState<PipelineRound[]>(loadPipeline);
  const hasApplication = pipeline.some((r) => r.status !== "locked");

  /* Determine the "continue" round — the first non-completed round */
  const currentRound = pipeline.find((r) => r.status === "current");
  const nextLockedIdx = pipeline.findIndex((r) => r.status === "locked");
  const allDone = pipeline.every((r) => r.status === "completed");

  /* Start a new application — marks round 1 as current */
  const startApplication = () => {
    const fresh = getDefaultPipeline();
    fresh[0].status = "current";
    localStorage.setItem("hr11_pipeline_progress", JSON.stringify(fresh));
    setPipeline(fresh);
    navigate(fresh[0].path);
  };

  /* Continue to the current round */
  const continueApplication = () => {
    if (currentRound) navigate(currentRound.path);
  };

  /* Sign out */
  const handleSignOut = () => {
    clearAuth();
    navigate("/");
  };

  useEffect(() => {
    if (!loggedIn) {
      navigate("/candidate-login");
    }
  }, [loggedIn, navigate]);

  if (!loggedIn) return null;

  return (
    <div className="min-h-screen bg-tertiary">
      {/* ── Top Nav ──────────────────────────────────────────── */}
      <nav className="flex items-center justify-between px-10 h-[60px] bg-tertiary border-b-2 border-secondary sticky top-0 z-30">
        <div
          onClick={() => navigate("/")}
          className="font-display font-black text-xl text-secondary cursor-pointer select-none"
        >
          HR<span className="text-primary">11</span>
          <span className="bg-primary text-white text-[8px] px-1.5 py-px ml-1.5">
            AI
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Btn size="sm" variant="ghost" onClick={() => navigate("/recent-openings")}>
            Browse Jobs
          </Btn>
          <Btn size="sm" variant="secondary" onClick={handleSignOut}>
            Sign Out
          </Btn>
        </div>
      </nav>

      <div className="max-w-[980px] mx-auto py-9 px-6">
        <div className="grid md:grid-cols-[300px_1fr] gap-6 items-start fade-up">
          {/* ── Left Column: Photo + Info ───────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Photo + Name Card */}
            <Card>
              <div className="p-7 flex flex-col items-center text-center">
                {/* Avatar / Photo */}
                <div
                  className="relative group cursor-pointer mb-4"
                  onClick={() => fileRef.current?.click()}
                >
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={name}
                      className="w-[80px] h-[80px] object-cover border-2 border-secondary"
                    />
                  ) : (
                    <Avatar initials={initials} size={80} />
                  )}
                  {/* overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                    <span className="text-white text-[10px] font-display font-extrabold tracking-[0.1em] uppercase">
                      Change
                    </span>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhoto}
                  />
                </div>

                <div className="font-display font-black text-xl uppercase text-secondary mb-1">
                  {name}
                </div>
                <div className="font-body text-[13px] text-primary font-semibold mb-1">
                  {role}
                </div>
                {email && (
                  <>
                    <Divider />
                    <div className="mt-3 flex gap-2 items-center">
                      <span className="text-sm">📧</span>
                      <span className="font-body text-xs text-ink-light">
                        {email}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </Card>

            {/* ── Top 5 Skills ──────────────────────────────── */}
            <Card>
              <div className="p-5">
                <SectionLabel>Top 5 Skills</SectionLabel>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {skills.map((s) => (
                    <span
                      key={s}
                      className="group inline-flex items-center gap-1.5"
                    >
                      <Tag>{s}</Tag>
                      <button
                        onClick={() => removeSkill(s)}
                        className="text-ink-faint hover:text-danger transition font-bold text-xs leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                {skills.length < 5 && (
                  <div className="flex gap-2 mt-3">
                    <input
                      type="text"
                      placeholder="Add a skill…"
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addSkill()}
                      className="flex-1 text-xs font-body border-2 border-secondary rounded-none px-3 py-1.5 bg-surface text-secondary placeholder:text-ink-faint focus:outline-none focus:border-primary transition"
                    />
                    <Btn size="sm" onClick={addSkill}>
                      Add
                    </Btn>
                  </div>
                )}
                {skills.length >= 5 && (
                  <p className="text-[11px] text-ink-faint font-body mt-2">
                    Maximum 5 skills. Remove one to add another.
                  </p>
                )}
              </div>
            </Card>
          </div>

          {/* ── Right Column: Pipeline + Resume + Actions ── */}
          <div className="flex flex-col gap-4">
            {/* ── Application Pipeline ──────────────────────── */}
            <Card>
              <div className="bg-secondary px-5 py-3">
                <span className="font-display font-extrabold text-xs text-white tracking-[0.15em] uppercase">
                  My Application Pipeline
                </span>
              </div>
              <div className="p-5">
                {!hasApplication ? (
                  <div className="text-center py-6">
                    <div className="text-[40px] mb-3">🚀</div>
                    <div className="font-display font-extrabold text-sm uppercase text-secondary mb-1">
                      No Active Application
                    </div>
                    <p className="font-body text-xs text-ink-faint mb-4">
                      Browse openings and apply to start your pipeline.
                    </p>
                    <Btn size="sm" onClick={() => navigate("/recent-openings")}>
                      Browse Openings →
                    </Btn>
                  </div>
                ) : (
                  <>
                    {/* Round list */}
                    <div className="flex flex-col gap-0.5">
                      {pipeline.map((round, idx) => {
                        const isCompleted = round.status === "completed";
                        const isCurrent = round.status === "current";
                        const isLocked = round.status === "locked";
                        return (
                          <div key={round.key}>
                            <div
                              onClick={() => {
                                if (isCurrent) navigate(round.path);
                                else if (isCompleted) navigate(round.path);
                              }}
                              className={[
                                "flex items-center gap-3 px-3 py-2.5 border-2 transition-all",
                                isCurrent
                                  ? "border-primary bg-primary/[0.06] cursor-pointer"
                                  : isCompleted
                                    ? "border-[#1A8917]/30 bg-[#f0fdf0] cursor-pointer"
                                    : "border-border-clr bg-surface-alt opacity-50 cursor-not-allowed",
                              ].join(" ")}
                            >
                              {/* Step number */}
                              <div
                                className={[
                                  "w-7 h-7 flex items-center justify-center shrink-0 font-display font-black text-xs border-2",
                                  isCompleted
                                    ? "bg-[#1A8917] border-[#1A8917] text-white"
                                    : isCurrent
                                      ? "bg-primary border-primary text-white"
                                      : "bg-surface border-secondary text-ink-faint",
                                ].join(" ")}
                              >
                                {isCompleted ? "✓" : idx + 1}
                              </div>

                              {/* Icon + label */}
                              <span className="text-base shrink-0">{round.icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className={[
                                  "font-display font-extrabold text-xs uppercase tracking-[0.05em]",
                                  isCompleted ? "text-[#1A8917]" : isCurrent ? "text-primary" : "text-ink-faint",
                                ].join(" ")}>
                                  {round.label}
                                </div>
                                <div className="text-[10px] font-body text-ink-faint">
                                  {isCompleted ? "Completed" : isCurrent ? "In progress — tap to continue" : "Locked"}
                                </div>
                              </div>

                              {/* Arrow for current */}
                              {isCurrent && (
                                <span className="text-primary font-display font-black text-sm">→</span>
                              )}
                            </div>

                            {/* Connector line */}
                            {idx < pipeline.length - 1 && (
                              <div className="flex justify-start pl-[22px]">
                                <div className={[
                                  "w-0.5 h-3",
                                  isCompleted ? "bg-[#1A8917]" : "bg-border-clr",
                                ].join(" ")} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Progress bar */}
                    <div className="mt-4">
                      <div className="flex justify-between text-[10px] font-display font-bold uppercase tracking-[0.1em] text-ink-faint mb-1">
                        <span>Progress</span>
                        <span>{pipeline.filter((r) => r.status === "completed").length}/{pipeline.length} rounds</span>
                      </div>
                      <div className="h-2 bg-surface-alt border border-border-clr">
                        <div
                          className={[
                            "h-full transition-all duration-500",
                            allDone ? "bg-[#1A8917]" : "bg-primary",
                          ].join(" ")}
                          style={{
                            width: `${(pipeline.filter((r) => r.status === "completed").length / pipeline.length) * 100}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* CTA */}
                    <div className="mt-4">
                      {allDone ? (
                        <div className="border-2 border-[#1A8917] bg-[#f0fdf0] p-4 text-center">
                          <div className="font-display font-black text-base uppercase text-[#1A8917] mb-1">
                            🎉 All Rounds Complete!
                          </div>
                          <p className="font-body text-xs text-ink-light">
                            Your results are being reviewed. You'll hear back soon.
                          </p>
                        </div>
                      ) : currentRound ? (
                        <Btn fullWidth onClick={continueApplication}>
                          Continue: {currentRound.label} →
                        </Btn>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </Card>

            {/* Resume Section */}
            <Card>
              <div className="bg-secondary px-5 py-3">
                <span className="font-display font-extrabold text-xs text-white tracking-[0.15em] uppercase">
                  Resume
                </span>
              </div>
              <div className="p-7">
                {resumeFile ? (
                  <div className="flex flex-col items-center text-center">
                    <div className="text-[52px] mb-3">📄</div>
                    <div className="font-display font-black text-lg uppercase text-secondary">
                      {resumeFile.name}
                    </div>
                    <p className="font-body text-xs text-ink-faint mt-1">
                      {(resumeFile.size / 1024).toFixed(1)} KB · Uploaded just now
                    </p>
                    <div className="flex gap-3 mt-5">
                      <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setResumeFile(null);
                          if (resumeRef.current) resumeRef.current.value = "";
                        }}
                      >
                        Remove
                      </Btn>
                      <Btn size="sm" onClick={() => resumeRef.current?.click()}>
                        Replace
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <div
                    className="border-2 border-dashed border-border-clr p-10 text-center cursor-pointer hover:border-primary hover:bg-surface-warm transition"
                    onClick={() => resumeRef.current?.click()}
                  >
                    <div className="text-[52px] mb-3">📎</div>
                    <div className="font-display font-black text-base uppercase text-secondary mb-1">
                      Upload your resume
                    </div>
                    <p className="font-body text-xs text-ink-faint">
                      PDF, DOC, or DOCX · Max 5MB
                    </p>
                  </div>
                )}

                <input
                  ref={resumeRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  onChange={handleResume}
                />
              </div>
            </Card>

            {/* Quick Actions */}
            <Card>
              <div className="p-5 flex flex-col gap-3">
                <SectionLabel>Quick Actions</SectionLabel>
                <Btn fullWidth onClick={() => navigate("/recent-openings")}>
                  Browse Recent Openings →
                </Btn>
                {hasApplication && currentRound && (
                  <Btn fullWidth variant="secondary" onClick={continueApplication}>
                    Continue Application →
                  </Btn>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
