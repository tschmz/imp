export interface SkillFrontmatter {
  name: string;
  description: string;
}

export interface SkillResourceDefinition {
  relativePath: string;
  filePath: string;
}

export interface SkillDefinition extends SkillFrontmatter {
  directoryPath: string;
  filePath: string;
  body: string;
  content: string;
  references: SkillResourceDefinition[];
  scripts: SkillResourceDefinition[];
}

export interface SkillCatalog {
  skills: SkillDefinition[];
  issues: string[];
}
