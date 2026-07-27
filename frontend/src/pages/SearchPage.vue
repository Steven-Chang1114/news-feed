<template>
  <input
    v-model="query"
    type="search"
    placeholder="Search recent news…"
    aria-label="Search recent news"
  />

  <p v-if="error" class="error">{{ error }}</p>

  <p v-if="loading" class="state">Searching…</p>

  <p v-else-if="searched && !results.length" class="state">
    Nothing found for “{{ query.trim() }}”.
  </p>

  <p v-else-if="!searched" class="state">
    Type at least two characters to search. Results are up to 12 hours old on the free
    news tier.
  </p>

  <article v-for="result in results" :key="result.url" class="row">
    <p class="row-title">{{ result.title }}</p>
    <p class="meta">
      {{ result.sourceName ?? 'Unknown source' }}
      <template v-if="result.publishedAt"> · {{ formatDate(result.publishedAt) }}</template>
    </p>

    <div class="row-actions">
      <!-- Already analyzed articles point at the feed rather than offering the work
           again, so the same article is not paid for twice by accident. -->
      <RouterLink v-if="result.analysisId" to="/feed">Analyzed · view in feed</RouterLink>
      <button v-else :disabled="analyzing !== null" @click="analyze(result)">
        {{ analyzing === result.url ? 'Analyzing…' : 'Analyze' }}
      </button>

      <a :href="result.url" target="_blank" rel="noreferrer noopener" class="meta">
        Open original
      </a>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { ListArticlesResponse } from '@news-feed/api-contract';
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { analyzeArticle, searchArticles } from '../api';

type Result = ListArticlesResponse['articles'][number];

const router = useRouter();

const query = ref('');
const results = ref<Result[]>([]);
const loading = ref(false);
const error = ref('');
const searched = ref(false);
/** The URL being analyzed, so only its own row shows a pending state. */
const analyzing = ref<string | null>(null);

/**
 * Debounced because the news provider allows 100 requests a day: one request per
 * keystroke would spend the daily budget in a single sentence.
 */
let timer: ReturnType<typeof setTimeout> | undefined;
watch(query, (value) => {
  clearTimeout(timer);
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    results.value = [];
    searched.value = false;
    return;
  }
  timer = setTimeout(() => void search(trimmed), 400);
});

async function search(q: string) {
  loading.value = true;
  error.value = '';
  try {
    results.value = (await searchArticles(q)).articles;
  } catch (caught) {
    error.value = (caught as Error).message;
    results.value = [];
  } finally {
    loading.value = false;
    searched.value = true;
  }
}

async function analyze(result: Result) {
  analyzing.value = result.url;
  error.value = '';
  try {
    const { analysisId, ...article } = result;
    await analyzeArticle(article);
    await router.push('/feed');
  } catch (caught) {
    error.value = (caught as Error).message;
  } finally {
    analyzing.value = null;
  }
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
}
</script>

<style scoped>
/* The only text input in the app, so its styling lives with it. */
input {
  font: inherit;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: var(--gap);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
}

input:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 1px;
}
</style>
