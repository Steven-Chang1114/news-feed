<template>
  <div class="filters">
    <button :aria-pressed="filter === null" @click="applyFilter(null)">All</button>
    <button
      v-for="sentiment in SENTIMENTS"
      :key="sentiment"
      class="capitalize"
      :aria-pressed="filter === sentiment"
      @click="applyFilter(sentiment)"
    >
      {{ sentiment }}
    </button>
  </div>

  <p v-if="error" class="error">{{ error }}</p>

  <p v-if="loading && !analyses.length" class="state">Loading…</p>

  <p v-else-if="!analyses.length" class="state">
    Nothing here yet. Search for an article and analyze it.
  </p>

  <article v-for="analysis in analyses" :key="analysis.id" class="row">
    <!-- The whole row header toggles, so the summary is one click away without
         leaving the page and without a second request. -->
    <button
      type="button"
      class="row-toggle"
      :aria-expanded="expanded === analysis.id"
      :aria-label="`Summary of ${analysis.article.title}`"
      @click="expanded = expanded === analysis.id ? null : analysis.id"
    >
      <p class="row-title">{{ analysis.article.title }}</p>
      <p class="meta">
        <span :class="['chip', `chip-${analysis.sentiment}`]">{{ analysis.sentiment }}</span>
        ·
        {{ analysis.article.sourceName ?? 'Unknown source' }}
        <template v-if="analysis.article.publishedAt">
          · {{ formatDate(analysis.article.publishedAt) }}
        </template>
      </p>
    </button>

    <div v-if="expanded === analysis.id">
      <p class="summary">{{ analysis.summary }}</p>

      <div class="row-actions">
        <a :href="analysis.article.url" target="_blank" rel="noreferrer noopener" class="meta">
          Open original
        </a>
        <button :disabled="busy === analysis.id" @click="reanalyze(analysis)">
          {{ busy === analysis.id ? 'Working…' : 'Re-analyze' }}
        </button>
        <button :disabled="busy === analysis.id" @click="remove(analysis)">Remove</button>
      </div>
    </div>
  </article>

  <p v-if="nextCursor" class="load-more">
    <button :disabled="loading" @click="load({ append: true })">
      {{ loading ? 'Loading…' : 'Load more' }}
    </button>
  </p>
</template>

<script setup lang="ts">
import { SENTIMENTS, type AnalysisResponse, type Sentiment } from '@news-feed/api-contract';
import { onMounted, ref } from 'vue';
import { analyzeArticle, deleteAnalysis, listAnalyses } from '../api';

const analyses = ref<AnalysisResponse[]>([]);
const nextCursor = ref<string | null>(null);
const filter = ref<Sentiment | null>(null);
const loading = ref(false);
const error = ref('');
/** The row currently expanded. One at a time keeps the list scannable. */
const expanded = ref<string | null>(null);
const busy = ref<string | null>(null);

async function load({ append = false } = {}) {
  loading.value = true;
  error.value = '';
  try {
    const page = await listAnalyses({
      ...(filter.value ? { sentiment: filter.value } : {}),
      ...(append && nextCursor.value ? { cursor: nextCursor.value } : {}),
    });
    analyses.value = append ? [...analyses.value, ...page.analyses] : page.analyses;
    nextCursor.value = page.nextCursor;
  } catch (caught) {
    error.value = (caught as Error).message;
  } finally {
    loading.value = false;
  }
}

function applyFilter(sentiment: Sentiment | null) {
  filter.value = sentiment;
  nextCursor.value = null;
  void load();
}

async function reanalyze(analysis: AnalysisResponse) {
  busy.value = analysis.id;
  error.value = '';
  try {
    const updated = await analyzeArticle(analysis.article);
    // Replaced in place rather than reloading: the row keeps its position, because
    // re-analyzing does not change the feed's ordering.
    analyses.value = analyses.value.map((item) => (item.id === updated.id ? updated : item));
  } catch (caught) {
    error.value = (caught as Error).message;
  } finally {
    busy.value = null;
  }
}

async function remove(analysis: AnalysisResponse) {
  busy.value = analysis.id;
  error.value = '';
  try {
    await deleteAnalysis(analysis.id);
    analyses.value = analyses.value.filter((item) => item.id !== analysis.id);
  } catch (caught) {
    error.value = (caught as Error).message;
  } finally {
    busy.value = null;
  }
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
}

onMounted(load);
</script>

<style scoped>
.filters {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.filters button[aria-pressed='true'] {
  background: var(--text);
  color: var(--bg);
  border-color: var(--text);
}

.capitalize {
  text-transform: capitalize;
}

/*
 * The row header is the toggle, so the target is the full width of the row rather
 * than a small chevron. `all: unset` strips the button's own appearance; the focus
 * ring is put back, because unsetting it would leave keyboard users with no
 * indication of where they are.
 */
.row-toggle {
  all: unset;
  display: block;
  width: 100%;
  cursor: pointer;
}

/*
 * `all: unset` does not survive the global `button:hover` rule, which is more
 * specific and would paint a square grey block inside the rounded card. The cursor
 * already signals that the row is clickable.
 */
.row-toggle:hover {
  background: none;
}

.row-toggle:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 2px;
}

/* Sentiment is the only saturated colour in the interface. */
.chip {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: capitalize;
}

.chip-positive {
  color: var(--positive);
  background: var(--positive-bg);
}

.chip-neutral {
  color: var(--neutral);
  background: var(--neutral-bg);
}

.chip-negative {
  color: var(--negative);
  background: var(--negative-bg);
}

.summary {
  margin: var(--gap) 0 0;
  padding-top: var(--gap);
  border-top: 1px solid var(--border);
}

.load-more {
  text-align: center;
}
</style>
