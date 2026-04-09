export interface SkillFrontmatter {
  name: string;
  description: string;
}

export interface SkillDefinition extends SkillFrontmatter {
  directoryPath: string;
  filePath: string;
  body: string;
  content: string;
}

export interface SkillCatalog {
  skills: SkillDefinition[];
  issues: string[];
}
