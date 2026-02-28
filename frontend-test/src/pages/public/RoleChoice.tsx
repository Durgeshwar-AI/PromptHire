import { Btn } from "../../assets/components/shared/Btn";
import { PublicNav } from "../../assets/components/layout/PublicNav";

export function RoleChoice({ onNavigate }: any) {
  return (
    <div className="min-h-screen bg-tertiary">
      <PublicNav onNavigate={onNavigate} currentPage="" />
      <div className="flex flex-col items-center justify-center h-[calc(100vh-60px)] px-6">
        <h1 className="font-display font-black text-[clamp(2rem,5vw,4rem)] uppercase tracking-tight text-secondary mb-8 text-center">
          Who are you?
        </h1>
        <div className="flex flex-col sm:flex-row gap-6">
          <Btn onClick={() => onNavigate("company-home")} style={{ minWidth: 220, fontSize: 16 }}>
            I&rsquo;m an HR / Company
          </Btn>
          <Btn variant="secondary" onClick={() => onNavigate("candidate-home")} style={{ minWidth: 220, fontSize: 16 }}>
            I&rsquo;m looking for a job
          </Btn>
        </div>
      </div>
    </div>
  );
}
