<script lang="ts">
  /** A letter in its ABC color (author's `letter()`), or plain text for digits and non-ABC values. */
  let {
    value,
    abc,
    abcColors,
    colored = true,
  }: {
    value: string;
    abc: readonly string[];
    abcColors: readonly string[];
    colored?: boolean;
  } = $props();
  const color = $derived.by(() => {
    const k = abc.indexOf(value);
    return colored && k >= 0 ? (abcColors[k] ?? '#1f2a37') : '#1f2a37';
  });
</script>

<span style="color:{color}">{value}</span>
