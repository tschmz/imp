import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentDefinition } from "../domain/agent.js";
import type { ConversationContext } from "../domain/conversation.js";
import { discoverSkills, mergeSkillCatalogs } from "./discovery.js";
import type { SkillDefinition } from "./types.js";

export interface EffectiveSkillResolutionResult {
  skills: SkillDefinition[];
  issues: string[];
  overriddenSkillNames: string[];
  globalSkillsPath?: string;
  userSharedSkillsPath?: string;
  agentHomeSkillsPath?: string;
  workspaceDirectory?: string;
  legacyWorkspaceSkillsPath?: string;
  workspaceAgentSkillsPath?: string;
  workspaceSkillsPath?: string;
}

export async function resolveEffectiveSkills(options: {
  agent: AgentDefinition;
  dataRoot?: string;
  conversation?: ConversationContext;
}): Promise<EffectiveSkillResolutionResult> {
  const configuredSkillCatalog = options.agent.skillCatalog ?? [];
  const globalSkillsPath = options.dataRoot ? join(options.dataRoot, "skills") : undefined;
  const userSharedSkillsPath = join(homedir(), ".agents", "skills");
  const agentHomeSkillsPath = options.agent.home ? join(options.agent.home, ".skills") : undefined;
  const workspaceDirectory = resolveWorkspaceDirectory(options.agent, options.conversation);
  const legacyWorkspaceSkillsPath = workspaceDirectory ? join(workspaceDirectory, ".skills") : undefined;
  const workspaceAgentSkillsPath = workspaceDirectory ? join(workspaceDirectory, ".agents", "skills") : undefined;
  const workspaceSkillsPath = workspaceDirectory ? join(workspaceDirectory, "skills") : undefined;

  const globalSkillCatalog = globalSkillsPath
    ? await discoverSkills([globalSkillsPath], { ignoreMissingPaths: true })
    : { skills: [], issues: [] };
  const userSharedSkillCatalog = await discoverSkills([userSharedSkillsPath], { ignoreMissingPaths: true });
  const agentHomeSkillCatalog = agentHomeSkillsPath
    ? await discoverSkills([agentHomeSkillsPath], { ignoreMissingPaths: true })
    : { skills: [], issues: [] };
  const legacyWorkspaceSkillCatalog = legacyWorkspaceSkillsPath
    ? await discoverSkills([legacyWorkspaceSkillsPath], { ignoreMissingPaths: true })
    : { skills: [], issues: [] };
  const workspaceAgentSkillCatalog = workspaceAgentSkillsPath
    ? await discoverSkills([workspaceAgentSkillsPath], { ignoreMissingPaths: true })
    : { skills: [], issues: [] };
  const workspaceSkillCatalog = workspaceSkillsPath
    ? await discoverSkills([workspaceSkillsPath], { ignoreMissingPaths: true })
    : { skills: [], issues: [] };

  const userSharedMergedSkillCatalog = mergeSkillCatalogs(globalSkillCatalog.skills, userSharedSkillCatalog.skills);
  const agentHomeMergedSkillCatalog = mergeSkillCatalogs(
    userSharedMergedSkillCatalog.skills,
    agentHomeSkillCatalog.skills,
  );
  const configuredMergedSkillCatalog = mergeSkillCatalogs(
    agentHomeMergedSkillCatalog.skills,
    configuredSkillCatalog,
  );
  const legacyWorkspaceMergedSkillCatalog = mergeSkillCatalogs(
    configuredMergedSkillCatalog.skills,
    legacyWorkspaceSkillCatalog.skills,
  );
  const workspaceAgentMergedSkillCatalog = mergeSkillCatalogs(
    legacyWorkspaceMergedSkillCatalog.skills,
    workspaceAgentSkillCatalog.skills,
  );
  const mergedSkillCatalog = mergeSkillCatalogs(workspaceAgentMergedSkillCatalog.skills, workspaceSkillCatalog.skills);

  return {
    skills: mergedSkillCatalog.skills,
    issues: [
      ...globalSkillCatalog.issues,
      ...userSharedSkillCatalog.issues,
      ...agentHomeSkillCatalog.issues,
      ...legacyWorkspaceSkillCatalog.issues,
      ...workspaceAgentSkillCatalog.issues,
      ...workspaceSkillCatalog.issues,
    ],
    overriddenSkillNames: [
      ...new Set([
        ...userSharedMergedSkillCatalog.overriddenSkillNames,
        ...agentHomeMergedSkillCatalog.overriddenSkillNames,
        ...configuredMergedSkillCatalog.overriddenSkillNames,
        ...legacyWorkspaceMergedSkillCatalog.overriddenSkillNames,
        ...workspaceAgentMergedSkillCatalog.overriddenSkillNames,
        ...mergedSkillCatalog.overriddenSkillNames,
      ]),
    ].sort((left, right) => left.localeCompare(right)),
    ...(globalSkillsPath ? { globalSkillsPath } : {}),
    ...(userSharedSkillsPath ? { userSharedSkillsPath } : {}),
    ...(agentHomeSkillsPath ? { agentHomeSkillsPath } : {}),
    ...(workspaceDirectory ? { workspaceDirectory } : {}),
    ...(legacyWorkspaceSkillsPath ? { legacyWorkspaceSkillsPath } : {}),
    ...(workspaceAgentSkillsPath ? { workspaceAgentSkillsPath } : {}),
    ...(workspaceSkillsPath ? { workspaceSkillsPath } : {}),
  };
}

function resolveWorkspaceDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext | undefined,
): string | undefined {
  return conversation?.state.workingDirectory ?? agent.workspace?.cwd;
}
