export type DoctorCheck = {
  name: string;
  ok: boolean;
  details: string;
};

export type DoctorResult = {
  ok: true;
  repoRoot: string;
  summary: "healthy" | "warning";
  checks: DoctorCheck[];
};
