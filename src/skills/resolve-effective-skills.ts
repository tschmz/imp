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
  agentHomeSkillsPath?: string;
  workspaceDirectory?: string;
  workspaceSkillsPath?: string;
}

export async function resolveEffectiveSkills(options: {
  agent: AgentDefinition;
  dataRoot?: string;
  conversation?: ConversationContext;
}): Promise<EffectiveSkillResolutionResult> {
  const configuredSkillCatalog = options.agent.skillCatalog ?? [];
  const globalSkillsPath = options.dataRoot ? join(options.dataRoot, "skills") : undefined;
  const agentHomeSkillsPath = options.agent.home ? join(options.agent.home, ".skills") : undefined;
  const workspaceDirectory = resolveWorkspaceDirectory(options.agent, options.conversation);
  const workspaceSkillsPath = workspaceDirectory ? join(workspaceDirectory, ".skills") : undefined;

  const globalSkillCatalog = globalSkillsPath
    ? await discoverSkills([globalSkillsPath], { ignoreMissingPaths: true })
    : { skills: [], issues: [] };
  const agentHomeSkillCatalog = agentHomeSkillsPath
    ? await discoverSkills([agentHomeSkillsPath], { ignoreMissingPaths: true })
    : { skills: [], issues: [] };
  const workspaceSkillCatalog = workspaceSkillsPath
    ? await discoverSkills([workspaceSkillsPath], { ignoreMissingPaths: true })
    : { skills: [], issues: [] };
  const agentHomeMergedSkillCatalog = mergeSkillCatalogs(globalSkillCatalog.skills, agentHomeSkillCatalog.skills);
  const configuredMergedSkillCatalog = mergeSkillCatalogs(
    agentHomeMergedSkillCatalog.skills,
    configuredSkillCatalog,
  );
  const mergedSkillCatalog = mergeSkillCatalogs(configuredMergedSkillCatalog.skills, workspaceSkillCatalog.skills);

  return {
    skills: mergedSkillCatalog.skills,
    issues: [
      ...globalSkillCatalog.issues,
      ...agentHomeSkillCatalog.issues,
      ...workspaceSkillCatalog.issues,
    ],
    overriddenSkillNames: [
      ...new Set([
        ...configuredMergedSkillCatalog.overriddenSkillNames,
        ...agentHomeMergedSkillCatalog.overriddenSkillNames,
        ...mergedSkillCatalog.overriddenSkillNames,
      ]),
    ].sort((left, right) => left.localeCompare(right)),
    ...(globalSkillsPath ? { globalSkillsPath } : {}),
    ...(agentHomeSkillsPath ? { agentHomeSkillsPath } : {}),
    ...(workspaceDirectory ? { workspaceDirectory } : {}),
    ...(workspaceSkillsPath ? { workspaceSkillsPath } : {}),
  };
}

function resolveWorkspaceDirectory(
  agent: AgentDefinition,
  conversation: ConversationContext | undefined,
): string | undefined {
  return conversation?.state.workingDirectory ?? agent.workspace?.cwd;
}
