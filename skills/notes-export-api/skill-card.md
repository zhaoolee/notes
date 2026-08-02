## Description: <br>
通过调用方明确配置的锤子便签 API 与 Token，完整查询、新增、更新、软删除、恢复和永久删除便签，并支持分类、星标、置顶、公众号富文本与 Markdown PNG 长图导出；Token 缺失时可用账号密码完成一次性授权。 <br>

This skill is ready for commercial/non-commercial use. <br>

## Publisher: <br>
[zhaoolee](https://clawhub.ai/zhaoolee) <br>

### License/Terms of Use: <br>
MIT-0 <br>


## Use Case: <br>
Developers and note-management users can manage an authenticated Smartisan Notes workspace through an explicitly configured API endpoint. The skill covers note CRUD, trash recovery and permanent deletion, folder classification, starring, pinning, WeChat-ready HTML generation, and PNG long-image export. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: The Skill Token, private notes, or local images are sent to the configured notes service when a command runs. <br>
Mitigation: Use a trusted self-hosted service, explicitly set NOTES_API_BASE_URL, and keep `.env` uncommitted. If username and password are used for first-run authorization, the script replaces them with a Token and removes them from `.env`. The scripts never auto-detect or fall back to another service. <br>
Risk: Permanent deletion is irreversible. <br>
Mitigation: Normal delete operations only move a note to trash. Permanent deletion requires the note to already be in trash and the caller to explicitly pass --permanent. <br>
Risk: Concurrent workspace writes could overwrite another update. <br>
Mitigation: Mutating commands use expectedUpdatedAt and retry against the latest workspace instead of blindly replacing stale state. <br>


## Reference(s): <br>
- [Workspace API and command reference](references/workspace-api.md) <br>
- [ClawHub skill page](https://clawhub.ai/zhaoolee/skills/notes-export-api) <br>
- [Source repository](https://github.com/zhaoolee/notes/tree/dev/skills/notes-export-api) <br>


## Skill Output: <br>
**Output Type(s):** [Text, Markdown, JSON, HTML, PNG, Shell commands, Configuration, Guidance] <br>
**Output Format:** [Structured JSON from note-management commands; HTML or PNG files for requested exports] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [Commands can update the authenticated account workspace and write requested HTML or PNG files.] <br>

## Skill Version(s): <br>
0.3.0 <br>

## Ethical Considerations: <br>
Users should only access workspaces they are authorized to manage, protect account credentials, review destructive requests before permanent deletion, and apply their organization's privacy, security, and retention requirements. <br>
