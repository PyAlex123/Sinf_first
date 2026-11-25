<script lang="ts">
  import {
    authoredToLesson,
    defaultStage,
    newBlockId,
    questionProblem,
    quizQuestionProblem,
    PRACTICE_FILE_EXTENSIONS,
    type AuthoredQuizQuestion,
    type AssetExtension,
    type PracticeTask,
    STAGE_KEYS,
    type AuthoredBlock,
    type AuthoredLesson,
    type AuthoredLessonDoc,
    type AuthoredStage,
    type Course,
    type LessonVisibility,
    type StageKey,
  } from '@sinf/shared';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { api, ApiError } from '../../lib/api.js';
  import { ensureStylesheet, forgetLesson } from '../../lib/content.js';
  import { t } from '../../lib/i18n/index.svelte.js';
  import { pictureFromFile } from '../../lib/images.js';
  import { router, type PageProps } from '../../lib/router.svelte.js';
  import Button from '../../lib/ui/Button.svelte';
  import Header from '../../lib/ui/Header.svelte';
  import Notice from '../../lib/ui/Notice.svelte';
  import LessonPlayer from '../../player/LessonPlayer.svelte';
  import PracticeTaskEditor from '../../lib/ui/PracticeTaskEditor.svelte';

  /**
   * The lesson constructor (PLAN.md 3.3; stage 4, W2; ADR-019): the stages on the lesson's 45
   * minutes, the slides of each, and the lesson as the class will see it. Everything is saved by
   * itself a moment after the last change, over the version it was made from.
   */
  let { params }: PageProps = $props();
  const lessonId = $derived(params['id'] ?? '');

  let lesson = $state<AuthoredLesson | null>(null);
  let doc = $state<AuthoredLessonDoc | null>(null);
  let title = $state('');
  let grade = $state(5);
  let topic = $state('');
  let visibility = $state<LessonVisibility>('private');
  let version = $state(1);
  let course = $state<Course | null>(null);
  let error = $state<string | null>(null);
  let status = $state<'saved' | 'dirty' | 'saving' | 'conflict' | 'failed'>('saved');
  let stageKey = $state<StageKey>('theory');
  let blockId = $state<string | null>(null);
  let preview = $state(false);
  let previewIndex = $state(0);
  let uploading = $state(false);

  const stage = $derived(doc?.stages.find((s) => s.key === stageKey) ?? doc?.stages[0] ?? null);
  const block = $derived(stage?.blocks.find((b) => b.id === blockId) ?? null);
  const total = $derived(doc?.stages.reduce((sum, s) => sum + s.minutes, 0) ?? 0);

  // ---------- loading and saving

  onMount(() => {
    void (async () => {
      try {
        const loaded = await api.authoredLesson(lessonId);
        if (!loaded.editable) {
          router.navigate(`/teacher/lesson/${loaded.id}`, { replace: true });
          return;
        }
        lesson = loaded;
        doc = loaded.doc;
        title = loaded.title;
        grade = loaded.grade;
        topic = loaded.topic;
        visibility = loaded.visibility;
        version = loaded.version;
        stageKey = loaded.doc.stages[0]?.key ?? 'theory';
        blockId = loaded.doc.stages[0]?.blocks[0]?.id ?? null;
        course = await api.lessonCourse(loaded.id);
        ensureStylesheet(course.styles);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.navigate('/teacher/login', { replace: true });
          return;
        }
        error =
          e instanceof ApiError && e.status === 404 ? t('common.notFound') : t('common.error');
      }
    })();
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let loadedOnce = false;
  /** One save at a time: a change made while one travels is saved right after it, over its version. */
  let inFlight = false;
  let again = false;

  /** Every change is saved a moment after the last one: no "Save" button to forget. */
  $effect(() => {
    // Everything that is saved is read here, so the effect follows it — and nothing else.
    const snapshot = JSON.stringify({ doc, title, grade, topic, visibility });
    untrack(() => {
      if (!doc) return;
      if (!loadedOnce) {
        loadedOnce = true;
        return;
      }
      void snapshot;
      if (status === 'conflict') return;
      status = 'dirty';
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void save(), 1200);
    });
  });

  async function save(): Promise<void> {
    if (!doc || !lesson || status === 'conflict' || !title.trim()) return;
    if (inFlight) {
      again = true;
      return;
    }
    // An emptied "minutes" field is not a reason to lose the rest: it counts as one minute.
    const toSave = $state.snapshot(doc);
    for (const st of toSave.stages) {
      st.minutes = Math.min(90, Math.max(1, Math.round(Number(st.minutes) || 1)));
    }
    if (toSave.stages.reduce((sum, st) => sum + st.minutes, 0) > 90) {
      status = 'failed';
      return;
    }
    inFlight = true;
    again = false;
    status = 'saving';
    try {
      const saved = await api.saveAuthoredLesson(lesson.id, {
        title: title.trim(),
        grade,
        topic: topic.trim(),
        visibility,
        doc: toSave,
        version,
      });
      version = saved.version;
      forgetLesson(saved.id);
      if (status === 'saving') status = 'saved';
    } catch (e) {
      status = e instanceof ApiError && e.code === 'version_conflict' ? 'conflict' : 'failed';
      again = false;
    } finally {
      inFlight = false;
    }
    if (again) void save();
  }

  /** Leaving with a change not yet saved: it goes now, without waiting for the timer. */
  function flush(): void {
    if (timer && status === 'dirty') {
      clearTimeout(timer);
      void save();
    }
  }

  // ---------- stages

  function hasStage(key: StageKey): boolean {
    return !!doc?.stages.some((s) => s.key === key);
  }

  function toggleStage(key: StageKey): void {
    if (!doc) return;
    if (hasStage(key)) {
      if (doc.stages.length === 1) return;
      doc.stages = doc.stages.filter((s) => s.key !== key);
      if (stageKey === key) stageKey = doc.stages[0]?.key ?? 'theory';
      return;
    }
    const fresh: AuthoredStage = defaultStage(key, 5);
    doc.stages = [...doc.stages, fresh].sort(
      (a, b) => STAGE_KEYS.indexOf(a.key) - STAGE_KEYS.indexOf(b.key),
    );
    stageKey = key;
    blockId = null;
  }

  function pickStage(key: StageKey): void {
    stageKey = key;
    special = null;
    blockId = doc?.stages.find((s) => s.key === key)?.blocks[0]?.id ?? null;
  }

  // ---------- the practice task and the live quiz (W5)

  /** The right-hand side shows a block, the practice task or the quiz. */
  let special = $state<'practice' | 'quiz' | null>(null);
  let templateBusy = $state(false);

  /** The editor's task, kept with this lesson's template and check-list switch. */
  function practiceChanged(task: PracticeTask | null): void {
    if (!doc || !task) return;
    const next: PracticeTask = {
      ...task,
      template: doc.practice?.template ?? null,
      showChecklist: doc.practice?.showChecklist ?? true,
    };
    // The editor reports the same task when it opens: that is not a change to save.
    if (JSON.stringify(next) !== JSON.stringify($state.snapshot(doc.practice))) doc.practice = next;
  }

  function removePractice(): void {
    if (!doc || !confirm(t('editor.practice.removeConfirm'))) return;
    doc.practice = null;
    special = null;
  }

  async function pickTemplate(file: File | undefined): Promise<void> {
    if (!file || !doc?.practice) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!PRACTICE_FILE_EXTENSIONS[doc.practice.app].includes(ext)) {
      error = t('editor.practice.wrongTemplate', {
        kinds: PRACTICE_FILE_EXTENSIONS[doc.practice.app].map((e) => `.${e}`).join(', '),
      });
      return;
    }
    templateBusy = true;
    error = null;
    try {
      const asset = await api.uploadAsset(file, ext as AssetExtension);
      doc.practice.template = `${asset.sha}.${asset.ext}`;
    } catch (e) {
      error = e instanceof ApiError ? e.message : t('common.error');
    } finally {
      templateBusy = false;
    }
  }

  function addQuizQuestion(): void {
    if (!doc) return;
    const fresh: AuthoredQuizQuestion = {
      text: '',
      options: ['', '', '', ''],
      correct: 0,
      limitSec: 20,
    };
    doc.quiz = { questions: [...(doc.quiz?.questions ?? []), fresh].slice(0, 20) };
  }

  function removeQuizQuestion(i: number): void {
    if (!doc?.quiz) return;
    const questions = doc.quiz.questions.filter((_, j) => j !== i);
    doc.quiz = questions.length > 0 ? { questions } : null;
  }

  // ---------- blocks

  function addSlide(): void {
    if (!stage) return;
    const fresh: AuthoredBlock = {
      id: newBlockId(),
      kind: 'slide',
      title: '',
      text: '',
      bullets: [],
      image: null,
    };
    stage.blocks = [...stage.blocks, fresh];
    blockId = fresh.id;
  }

  function addQuestion(): void {
    if (!stage) return;
    const fresh: AuthoredBlock = {
      id: newBlockId(),
      kind: 'question',
      text: '',
      mode: 'single',
      options: [
        { text: '', correct: true },
        { text: '', correct: false },
        { text: '', correct: false },
      ],
      answers: [],
    };
    stage.blocks = [...stage.blocks, fresh];
    blockId = fresh.id;
  }

  /** One right choice in a "single" question: picking one takes the mark from the others. */
  function markCorrect(i: number, on: boolean): void {
    if (block?.kind !== 'question') return;
    const single = block.mode === 'single';
    block.options = block.options.map((o, j) =>
      j === i ? { ...o, correct: on } : single && on ? { ...o, correct: false } : o,
    );
  }

  function addOption(): void {
    if (block?.kind !== 'question' || block.options.length >= 6) return;
    block.options = [...block.options, { text: '', correct: false }];
  }

  function removeOption(i: number): void {
    if (block?.kind !== 'question') return;
    block.options = block.options.filter((_, j) => j !== i);
  }

  const answersText = $derived(block?.kind === 'question' ? block.answers.join('\n') : '');
  function setAnswers(value: string): void {
    if (block?.kind !== 'question') return;
    block.answers = value
      .split('\n')
      .slice(0, 10)
      .map((l) => l.slice(0, 60));
  }
  const problem = $derived(block?.kind === 'question' ? questionProblem(block) : null);

  function removeBlock(id: string): void {
    if (!stage) return;
    const i = stage.blocks.findIndex((b) => b.id === id);
    stage.blocks = stage.blocks.filter((b) => b.id !== id);
    blockId = stage.blocks[Math.max(0, i - 1)]?.id ?? null;
  }

  function duplicate(id: string): void {
    if (!stage) return;
    const i = stage.blocks.findIndex((b) => b.id === id);
    const source = stage.blocks[i];
    if (!source) return;
    const copy = { ...$state.snapshot(source), id: newBlockId() };
    stage.blocks = [...stage.blocks.slice(0, i + 1), copy, ...stage.blocks.slice(i + 1)];
    blockId = copy.id;
  }

  function move(id: string, by: number): void {
    if (!stage) return;
    const i = stage.blocks.findIndex((b) => b.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= stage.blocks.length) return;
    const list = [...stage.blocks];
    const [item] = list.splice(i, 1);
    if (item) list.splice(j, 0, item);
    stage.blocks = list;
  }

  /** Drag and drop in the list of slides; the arrows do the same from the keyboard. */
  let dragging = $state<string | null>(null);
  function drop(targetId: string): void {
    if (!stage || !dragging || dragging === targetId) return;
    const from = stage.blocks.findIndex((b) => b.id === dragging);
    const to = stage.blocks.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const list = [...stage.blocks];
    const [item] = list.splice(from, 1);
    if (item) list.splice(to, 0, item);
    stage.blocks = list;
    dragging = null;
  }

  const bulletsText = $derived(block?.kind === 'slide' ? block.bullets.join('\n') : '');
  function setBullets(value: string): void {
    if (block?.kind !== 'slide') return;
    block.bullets = value
      .split('\n')
      .slice(0, 12)
      .map((l) => l.slice(0, 200));
  }

  async function pickImage(file: File | undefined): Promise<void> {
    if (!file || block?.kind !== 'slide') return;
    const target = block;
    uploading = true;
    error = null;
    try {
      const picture = await pictureFromFile(file);
      const asset = await api.uploadAsset(picture.blob, 'webp');
      target.image = { sha: asset.sha, ext: 'webp', width: picture.width, height: picture.height };
    } catch {
      error = t('editor.imageFailed');
    } finally {
      uploading = false;
    }
  }

  onDestroy(flush);

  // ---------- slides from a PDF (W3)

  let pdfProgress = $state<{ done: number; total: number } | null>(null);
  async function importPdf(file: File | undefined): Promise<void> {
    if (!file || !stage) return;
    const target = stage;
    error = null;
    pdfProgress = { done: 0, total: 0 };
    try {
      const { pdfToPictures, PdfProblem } = await import('../../lib/pdf-slides.js');
      try {
        const pictures = await pdfToPictures(
          file,
          (done, total) => (pdfProgress = { done, total }),
        );
        const added: AuthoredBlock[] = [];
        for (const picture of pictures) {
          const asset = await api.uploadAsset(picture.blob, 'webp');
          added.push({
            id: newBlockId(),
            kind: 'slide',
            title: '',
            text: '',
            bullets: [],
            image: { sha: asset.sha, ext: 'webp', width: picture.width, height: picture.height },
          });
        }
        target.blocks = [...target.blocks, ...added].slice(0, 60);
        blockId = added[0]?.id ?? blockId;
      } catch (e) {
        error = e instanceof PdfProblem ? t(`editor.pdf.${e.code}`) : t('editor.pdf.unreadable');
      }
    } finally {
      pdfProgress = null;
    }
  }

  // ---------- slides from PowerPoint (stage 6, B4)

  let pptxProgress = $state<{ done: number; total: number } | null>(null);
  async function importPptx(file: File | undefined): Promise<void> {
    if (!file || !stage) return;
    const target = stage;
    error = null;
    pptxProgress = { done: 0, total: 0 };
    try {
      const { pptxToSlides, PptxProblem } = await import('../../lib/pptx-slides.js');
      try {
        const slides = await pptxToSlides(file, (done, total) => (pptxProgress = { done, total }));
        const added: AuthoredBlock[] = [];
        for (const slide of slides) {
          const asset = slide.picture ? await api.uploadAsset(slide.picture.blob, 'webp') : null;
          added.push({
            id: newBlockId(),
            kind: 'slide',
            title: slide.title,
            text: slide.text,
            bullets: slide.bullets,
            image:
              asset && slide.picture
                ? {
                    sha: asset.sha,
                    ext: 'webp',
                    width: slide.picture.width,
                    height: slide.picture.height,
                  }
                : null,
          });
        }
        target.blocks = [...target.blocks, ...added].slice(0, 60);
        blockId = added[0]?.id ?? blockId;
      } catch (e) {
        error = e instanceof PptxProblem ? t(`editor.pptx.${e.code}`) : t('editor.pptx.unreadable');
      }
    } finally {
      pptxProgress = null;
    }
  }

  // ---------- preview

  const previewLesson = $derived(
    doc && lesson
      ? authoredToLesson({
          id: lesson.id,
          title: title || lesson.title,
          topic,
          doc: $state.snapshot(doc),
        })
      : null,
  );

  function openPreview(): void {
    if (!doc) return;
    // The screen of the slide being edited: stages before it, each with at least one screen.
    let at = 0;
    for (const s of doc.stages) {
      if (s.key === stageKey) {
        const i = s.blocks.findIndex((b) => b.id === blockId);
        at += Math.max(0, i);
        break;
      }
      at += Math.max(1, s.blocks.length);
    }
    previewIndex = at;
    preview = true;
  }

  function closeOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && preview) preview = false;
  }

  const blockLabel = (b: AuthoredBlock, i: number): string =>
    b.kind === 'question'
      ? `? ${b.text.trim().slice(0, 40) || t('editor.questionN', { n: i + 1 })}`
      : b.title.trim() || b.text.trim().slice(0, 40) || t('editor.slideN', { n: i + 1 });
</script>

<svelte:window onkeydown={closeOnEscape} onbeforeunload={flush} />

<Header back="/teacher" title={title || t('editor.title')}>
  <span class="status" data-status={status} role="status">
    {t(`editor.status.${status}`)}
  </span>
  {#if doc}
    <Button size="sm" variant="secondary" onclick={openPreview}>{t('editor.preview')}</Button>
  {/if}
</Header>

<main class="page editor">
  {#if error}<Notice kind="error">{error}</Notice>{/if}
  {#if status === 'conflict'}
    <Notice kind="error">{t('editor.conflict')}</Notice>
  {/if}
  {#if !doc}
    {#if !error}<p aria-busy="true" class="muted">{t('common.loading')}</p>{/if}
  {:else}
    <section class="meta">
      <label class="wide">
        <span>{t('own.lessonTitle')}</span>
        <input bind:value={title} maxlength="120" required data-field="title" />
      </label>
      <label>
        <span>{t('class.create.grade')}</span>
        <select bind:value={grade}>
          {#each Array.from({ length: 11 }, (_, i) => i + 1) as g (g)}
            <option value={g}>{g}</option>
          {/each}
        </select>
      </label>
      <label class="wide">
        <span>{t('editor.topic')}</span>
        <input bind:value={topic} maxlength="200" />
      </label>
      <label>
        <span>{t('editor.visibility')}</span>
        <select bind:value={visibility}>
          <option value="private">{t('own.visibility.private')}</option>
          <option value="school">{t('own.visibility.school')}</option>
          <option value="public">{t('own.visibility.public')}</option>
        </select>
      </label>
    </section>

    <!-- The lesson's minutes as a bar: each stage as wide as it is long. -->
    <section class="timeline" aria-label={t('editor.timeline')}>
      <div class="bar">
        {#each doc.stages as s (s.key)}
          <button
            type="button"
            class="seg"
            class:on={s.key === stage?.key}
            class:pc={s.place === 'computer'}
            style="flex: {s.minutes}"
            data-stage={s.key}
            onclick={() => pickStage(s.key)}
          >
            <b>{s.title}</b>
            <span>{t('editor.minutes', { count: s.minutes })}</span>
          </button>
        {/each}
      </div>
      <p class="total" class:over={total > 45}>
        {t('editor.total', { minutes: total })}
        {#if total > 90}· {t('editor.total90')}{:else if total !== 45}· {t('editor.total45')}{/if}
      </p>
      <div class="keys">
        {#each STAGE_KEYS as key (key)}
          <label class="key">
            <input
              type="checkbox"
              checked={hasStage(key)}
              onchange={() => toggleStage(key)}
              data-toggle={key}
            />
            {t(`editor.stage.${key}`)}
          </label>
        {/each}
      </div>
    </section>

    {#if stage}
      <div class="work">
        <section class="stagebox">
          <h2>{t('editor.stageSettings')}</h2>
          <label>
            <span>{t('editor.stageTitle')}</span>
            <input bind:value={stage.title} maxlength="40" data-field="stage-title" />
          </label>
          <label>
            <span>{t('editor.stageMinutes')}</span>
            <input
              type="number"
              min="1"
              max="90"
              bind:value={stage.minutes}
              data-field="stage-minutes"
            />
          </label>
          <label>
            <span>{t('editor.place')}</span>
            <select bind:value={stage.place}>
              <option value="projector">{t('editor.place.projector')}</option>
              <option value="computer">{t('editor.place.computer')}</option>
            </select>
          </label>
          {#if stage.key === 'practice'}<p class="muted small">{t('editor.practiceHint')}</p>{/if}
          {#if stage.key === 'reflection'}<p class="muted small">{t('editor.quizHint')}</p>{/if}

          <h2>{t('editor.slides')}</h2>
          <ol class="blocks">
            {#each stage.blocks as b, i (b.id)}
              <li
                class:on={b.id === blockId}
                draggable="true"
                ondragstart={() => (dragging = b.id)}
                ondragover={(e) => e.preventDefault()}
                ondrop={() => drop(b.id)}
                data-block={b.id}
              >
                <button
                  type="button"
                  class="pick"
                  onclick={() => {
                    blockId = b.id;
                    special = null;
                  }}
                >
                  {i + 1}. {blockLabel(b, i)}
                </button>
                <span class="tools">
                  <button
                    type="button"
                    aria-label={t('editor.up')}
                    title={t('editor.up')}
                    onclick={() => move(b.id, -1)}
                    disabled={i === 0}>↑</button
                  >
                  <button
                    type="button"
                    aria-label={t('editor.down')}
                    title={t('editor.down')}
                    onclick={() => move(b.id, 1)}
                    disabled={i === stage.blocks.length - 1}>↓</button
                  >
                </span>
              </li>
            {/each}
          </ol>
          {#if stage.blocks.length === 0}<p class="muted small">{t('editor.noSlides')}</p>{/if}
          <div class="row">
            <Button size="sm" variant="secondary" onclick={addSlide}
              >+ {t('editor.addSlide')}</Button
            >
            <Button size="sm" variant="secondary" onclick={addQuestion}
              >+ {t('editor.addQuestion')}</Button
            >
            <label class="file ghost">
              {pdfProgress
                ? t('editor.pdf.progress', {
                    done: pdfProgress.done,
                    total: pdfProgress.total || '…',
                  })
                : t('editor.pdf.import')}
              <input
                type="file"
                accept="application/pdf"
                disabled={!!pdfProgress}
                onchange={(e) => void importPdf(e.currentTarget.files?.[0])}
                data-field="pdf"
              />
            </label>
            <label class="file ghost">
              {pptxProgress
                ? t('editor.pptx.progress', {
                    done: pptxProgress.done,
                    total: pptxProgress.total || '…',
                  })
                : t('editor.pptx.import')}
              <input
                type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                disabled={!!pptxProgress}
                onchange={(e) => void importPptx(e.currentTarget.files?.[0])}
                data-field="pptx"
              />
            </label>
          </div>
          <p class="muted small">{t('editor.pdf.hint')}</p>
          {#if stage.key === 'practice'}
            <Button
              size="sm"
              variant={special === 'practice' ? 'primary' : 'secondary'}
              onclick={() => (special = 'practice')}
            >
              {doc.practice ? t('editor.practice.open') : t('editor.practice.add')}
            </Button>
          {/if}
          {#if stage.key === 'reflection'}
            <Button
              size="sm"
              variant={special === 'quiz' ? 'primary' : 'secondary'}
              onclick={() => (special = 'quiz')}
            >
              {t('editor.quiz.open', { count: doc.quiz?.questions.length ?? 0 })}
            </Button>
          {/if}
        </section>

        <section class="blockbox">
          {#if special === 'practice'}
            <h2>{t('editor.practice.title')}</h2>
            <p class="muted small">{t('editor.practice.hint')}</p>
            <PracticeTaskEditor initial={doc.practice} onChange={practiceChanged} />
            {#if doc.practice}
              <div class="template">
                <span class="muted small">
                  {doc.practice.template
                    ? t('editor.practice.templateSet', { name: doc.practice.fileName })
                    : t('editor.practice.noTemplate')}
                </span>
                <label class="file ghost">
                  {templateBusy ? t('files.uploading') : t('editor.practice.uploadTemplate')}
                  <input
                    type="file"
                    disabled={templateBusy}
                    onchange={(e) => void pickTemplate(e.currentTarget.files?.[0])}
                    data-field="template"
                  />
                </label>
              </div>
              <label class="check">
                <input type="checkbox" bind:checked={doc.practice.showChecklist} />
                {t('editor.practice.checklist')}
              </label>
              <Button size="sm" variant="ghost" onclick={removePractice}
                >{t('editor.practice.remove')}</Button
              >
            {/if}
          {:else if special === 'quiz'}
            <h2>{t('editor.quiz.title')}</h2>
            <p class="muted small">{t('editor.quiz.hint')}</p>
            {#each doc.quiz?.questions ?? [] as q, i (i)}
              {@const qp = quizQuestionProblem(q)}
              <div class="quizq" data-quiz={i}>
                <div class="qhead">
                  <b>{t('editor.quiz.n', { n: i + 1 })}</b>
                  <label class="inline">
                    {t('editor.quiz.seconds')}
                    <input type="number" min="5" max="120" bind:value={q.limitSec} />
                  </label>
                  <button
                    type="button"
                    class="x"
                    aria-label={t('editor.quiz.remove')}
                    onclick={() => removeQuizQuestion(i)}>×</button
                  >
                </div>
                <input
                  bind:value={q.text}
                  maxlength="200"
                  placeholder={t('editor.quiz.question')}
                  data-field="quiz-text"
                />
                {#each [0, 1, 2, 3] as o (o)}
                  <div class="option">
                    <input
                      type="radio"
                      name={`quiz-${i}`}
                      checked={q.correct === o}
                      onchange={() => (q.correct = o)}
                      aria-label={t('editor.correct')}
                      data-quiz-correct={o}
                    />
                    <input
                      value={q.options[o] ?? ''}
                      oninput={(e) => {
                        const opts = [...q.options];
                        while (opts.length <= o) opts.push('');
                        opts[o] = e.currentTarget.value;
                        q.options = opts.slice(0, 4);
                      }}
                      maxlength="60"
                      placeholder={t('editor.quiz.option', { n: o + 1 })}
                      data-quiz-option={o}
                    />
                    <span></span>
                  </div>
                {/each}
                {#if qp}<p class="warn">{t(`editor.quiz.problem.${qp}`)}</p>{/if}
              </div>
            {/each}
            {#if (doc.quiz?.questions.length ?? 0) < 20}
              <Button size="sm" variant="secondary" onclick={addQuizQuestion}
                >+ {t('editor.quiz.add')}</Button
              >
            {/if}
          {:else if block?.kind === 'slide'}
            <h2>{t('editor.slide')}</h2>
            <label>
              <span>{t('editor.slideTitle')}</span>
              <input bind:value={block.title} maxlength="120" data-field="slide-title" />
            </label>
            <label>
              <span>{t('editor.slideText')}</span>
              <textarea bind:value={block.text} maxlength="1500" rows="5" data-field="slide-text"
              ></textarea>
            </label>
            <label>
              <span>{t('editor.slideBullets')}</span>
              <textarea
                value={bulletsText}
                oninput={(e) => setBullets(e.currentTarget.value)}
                rows="4"
                data-field="slide-bullets"
              ></textarea>
            </label>
            <div class="image">
              {#if block.image}
                <img
                  src={`/content/_assets/${block.image.sha}.${block.image.ext}`}
                  alt={t('editor.picture')}
                  width={block.image.width}
                  height={block.image.height}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => block?.kind === 'slide' && (block.image = null)}
                >
                  {t('editor.removePicture')}
                </Button>
              {/if}
              <label class="file">
                {uploading
                  ? t('files.uploading')
                  : block.image
                    ? t('editor.changePicture')
                    : t('editor.addPicture')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onchange={(e) => void pickImage(e.currentTarget.files?.[0])}
                  data-field="slide-image"
                />
              </label>
            </div>
            <div class="row">
              <Button size="sm" variant="secondary" onclick={() => block && duplicate(block.id)}
                >{t('editor.duplicate')}</Button
              >
              <Button size="sm" variant="ghost" onclick={() => block && removeBlock(block.id)}
                >{t('editor.removeSlide')}</Button
              >
            </div>
          {:else if block?.kind === 'question'}
            <h2>{t('editor.question')}</h2>
            <label>
              <span>{t('editor.questionText')}</span>
              <textarea bind:value={block.text} maxlength="300" rows="3" data-field="question-text"
              ></textarea>
            </label>
            <label>
              <span>{t('editor.questionMode')}</span>
              <select bind:value={block.mode} data-field="question-mode">
                <option value="single">{t('editor.mode.single')}</option>
                <option value="multi">{t('editor.mode.multi')}</option>
                <option value="input">{t('editor.mode.input')}</option>
              </select>
            </label>
            {#if block.mode === 'input'}
              <label>
                <span>{t('editor.answers')}</span>
                <textarea
                  value={answersText}
                  oninput={(e) => setAnswers(e.currentTarget.value)}
                  rows="3"
                  data-field="question-answers"
                ></textarea>
              </label>
              <p class="muted small">{t('editor.answersHint')}</p>
            {:else}
              <div class="options">
                <span class="muted small">{t('editor.options')}</span>
                {#each block.options as option, i (i)}
                  <div class="option">
                    <input
                      type={block.mode === 'single' ? 'radio' : 'checkbox'}
                      name="correct"
                      checked={option.correct}
                      onchange={(e) => markCorrect(i, e.currentTarget.checked)}
                      aria-label={t('editor.correct')}
                      title={t('editor.correct')}
                      data-correct={i}
                    />
                    <input bind:value={option.text} maxlength="120" data-option={i} />
                    <button
                      type="button"
                      class="x"
                      aria-label={t('editor.removeOption')}
                      onclick={() => removeOption(i)}>×</button
                    >
                  </div>
                {/each}
                {#if block.options.length < 6}
                  <Button size="sm" variant="ghost" onclick={addOption}
                    >+ {t('editor.addOption')}</Button
                  >
                {/if}
              </div>
            {/if}
            {#if problem}<p class="warn" data-problem={problem}>
                {t(`editor.problem.${problem}`)}
              </p>{/if}
            <div class="row">
              <Button size="sm" variant="secondary" onclick={() => block && duplicate(block.id)}
                >{t('editor.duplicate')}</Button
              >
              <Button size="sm" variant="ghost" onclick={() => block && removeBlock(block.id)}
                >{t('editor.removeQuestion')}</Button
              >
            </div>
          {:else}
            <p class="muted">{t('editor.pickSlide')}</p>
          {/if}
        </section>
      </div>
    {/if}
  {/if}
</main>

{#if preview && previewLesson && course}
  <div class="previewer" role="dialog" aria-label={t('editor.preview')}>
    <LessonPlayer
      lesson={previewLesson}
      {course}
      pics={{}}
      bind:index={previewIndex}
      navigation="free"
    />
    <button type="button" class="closer" onclick={() => (preview = false)}
      >{t('common.close')}</button
    >
  </div>
{/if}

<style>
  .editor {
    display: grid;
    gap: var(--space-4);
  }
  .status {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .status[data-status='conflict'],
  .status[data-status='failed'] {
    color: var(--c-danger);
  }
  label {
    display: grid;
    gap: var(--space-1);
  }
  label > span {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--c-muted);
  }
  input,
  select,
  textarea {
    font: inherit;
    padding: var(--space-2);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-sm, 6px);
    background: var(--c-surface);
  }
  .meta {
    display: grid;
    grid-template-columns: 2fr 90px 2fr 160px;
    gap: var(--space-3);
  }
  .timeline .bar {
    display: flex;
    gap: 2px;
    min-height: 56px;
  }
  .seg {
    min-width: 60px;
    display: grid;
    align-content: center;
    padding: var(--space-1) var(--space-2);
    border: 2px solid transparent;
    border-radius: var(--radius-sm, 6px);
    background: var(--c-accent-soft);
    text-align: left;
    overflow: hidden;
    font: inherit;
    cursor: pointer;
  }
  .seg.pc {
    background: #e2f4ef;
  }
  .seg.on {
    border-color: var(--c-accent);
  }
  .seg b,
  .seg span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .seg span {
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .total {
    margin: var(--space-1) 0;
    font-size: var(--text-sm);
    color: var(--c-muted);
  }
  .total.over {
    color: var(--c-danger);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .key {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    font-weight: 600;
  }
  .work {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  .stagebox,
  .blockbox {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm, 0 1px 3px rgb(0 0 0 / 0.08));
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .blocks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .blocks li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-sm, 6px);
    background: var(--c-bg);
  }
  .blocks li.on {
    border-color: var(--c-accent);
    background: var(--c-accent-soft);
  }
  .pick {
    flex: 1;
    min-width: 0;
    padding: var(--space-2);
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: grab;
  }
  .tools button {
    border: 0;
    background: none;
    font-size: var(--text-md);
    padding: 0 var(--space-1);
    cursor: pointer;
  }
  .image {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .image img {
    max-width: 240px;
    max-height: 140px;
    width: auto;
    height: auto;
    border-radius: var(--radius-sm, 6px);
    border: 1px solid var(--c-field-line);
  }
  .file {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-sm);
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--c-accent);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
  }
  .file input {
    display: none;
  }
  .file.ghost {
    background: var(--c-surface);
    color: var(--c-dark);
    border: 1px solid var(--c-field-line);
  }
  .row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .options {
    display: grid;
    gap: var(--space-2);
  }
  .option {
    display: grid;
    grid-template-columns: 24px 1fr 32px;
    gap: var(--space-2);
    align-items: center;
  }
  .x {
    border: 0;
    background: none;
    font-size: var(--text-lg);
    cursor: pointer;
  }
  .template,
  .qhead {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .check,
  .inline {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
  }
  .inline input {
    width: 5em;
  }
  .quizq {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--c-field-line);
    border-radius: var(--radius-sm, 6px);
  }
  .qhead .x {
    margin-left: auto;
  }
  .warn {
    margin: 0;
    color: var(--c-danger);
    font-size: var(--text-sm);
  }
  .muted {
    color: var(--c-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
  .previewer {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: var(--c-bg);
  }
  .closer {
    position: fixed;
    top: var(--space-2);
    right: var(--space-2);
    z-index: 81;
    min-height: var(--control-sm);
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--c-dark);
    color: #fff;
    font-weight: 700;
  }
  @media (max-width: 1100px) {
    .meta {
      grid-template-columns: 1fr 1fr;
    }
    .work {
      grid-template-columns: 1fr;
    }
  }
</style>
