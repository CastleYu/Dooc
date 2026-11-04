export class DocType {
  static architecture = "architecture";
  static design = "design";
  static adr = "adr";
  static api = "api";
  static guide = "guide";
  static reference = "reference";
  static analysis = "analysis";
  static all = [
    DocType.architecture,
    DocType.design,
    DocType.adr,
    DocType.api,
    DocType.guide,
    DocType.reference,
    DocType.analysis,
  ];
}

export class Need {
  static id = "id";
  static title = "title";
  static description = "description";
  static type = "type";
  static status = "status";
  static tags = "tags";
  static owners = "owners";
  static codeRefs = "code_refs";
  static symbols = "symbols";
  static created = "created_at";
  static updated = "updated_at";
  static lists = [Need.tags, Need.owners, Need.codeRefs, Need.symbols];
  static rest = [
    Need.title,
    Need.description,
    Need.status,
    Need.tags,
    Need.owners,
    Need.codeRefs,
    Need.symbols,
    Need.created,
    Need.updated,
  ];
}

export class Ann {
  static open = "open";
  static progress = "in_progress";
  static resolved = "resolved";
  static dismissed = "dismissed";
  static bound = "bound";
  static orphaned = "orphaned";
}

export class Actor {
  static user = "user";
  static agent = "agent";
}

export class Chg {
  static proposed = "proposed";
  static review = "awaiting_review";
  static merged = "merged";
}

export class TaskSt {
  static open = "open";
  static progress = "in_progress";
  static done = "done";
  static cancelled = "cancelled";
  static all = [TaskSt.open, TaskSt.progress, TaskSt.done, TaskSt.cancelled];
}

export class Code {
  static fmMissing = "frontmatter_missing";
  static idMissing = "id_missing";
  static idChanged = "id_changed";
  static typeInvalid = "type_invalid";
  static keyMissing = "key_missing";
  static stale = "stale";
  static path = "path";
  static badPatch = "bad_patch";
  static badState = "bad_state";
  static forbidden = "forbidden";
  static notFound = "not_found";
  static badAnchor = "bad_anchor";
}

export class Hdr {
  static actorType = "x-actor-type";
  static actorId = "x-actor-id";
}

export class Tree {
  static docs = "docs";
  static branch = "main";
}

export class Tool {
  static search = "docs_search";
  static get = "docs_get";
  static outline = "docs_get_outline";
  static related = "docs_get_related";
  static refs = "docs_get_code_refs";
  static notes = "comments_list";
  static note = "comments_get";
  static addNote = "comments_create";
  static reply = "comments_reply";
  static moveNote = "comments_update_status";
  static propose = "docs_propose_edit";
  static diff = "docs_get_diff";
  static check = "docs_validate";
  static submit = "docs_submit_change";
  static history = "docs_get_history";
  static addTask = "tasks_create";
  static tasks = "tasks_list";
  static task = "tasks_get";
  static moveTask = "tasks_update";
  static all = [
    Tool.search,
    Tool.get,
    Tool.outline,
    Tool.related,
    Tool.refs,
    Tool.notes,
    Tool.note,
    Tool.addNote,
    Tool.reply,
    Tool.moveNote,
    Tool.propose,
    Tool.diff,
    Tool.check,
    Tool.submit,
    Tool.history,
    Tool.addTask,
    Tool.tasks,
    Tool.task,
    Tool.moveTask,
  ];
}

export class Res {
  static index = "docs://index";
  static doc = "docs://document/{doc_id}";
  static docOutline = "docs://document/{doc_id}/outline";
  static docNotes = "docs://document/{doc_id}/comments";
  static docHist = "docs://document/{doc_id}/history";
  static task = "docs://task/{task_id}";
  static markdown = "docs://standards/markdown";
  static types = "docs://standards/document-types";
  static all = [
    Res.index,
    Res.doc,
    Res.docOutline,
    Res.docNotes,
    Res.docHist,
    Res.task,
    Res.markdown,
    Res.types,
  ];
}

export class Prompt {
  static code = "analyze-code-to-docs";
  static review = "review-document";
  static comment = "process-comment";
  static update = "update-document";
  static design = "generate-design-document";
  static all = [Prompt.code, Prompt.review, Prompt.comment, Prompt.update, Prompt.design];
}
