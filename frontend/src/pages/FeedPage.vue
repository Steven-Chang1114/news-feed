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
    <!-- The whole row toggles, so the summary is one click away without leaving the
         page and without a second request. -->
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
        <a
          :href="analysis.article.url"
          target="_blank"
          rel="noreferrer noopener"
          class="meta"
        >
          Open original
        </a>
        <button :disabled="busy === analysis.id" @click="reanalyze(analysis)">
          {{ busy === analysis.id ? 'Working…' : 'Re-analyze' }}
        </button>
        <button :disabled="busy === analysis.id" @click="remove(analysis)">Remove</button>
      </div>
    </div>
  </article>

  <p v-if="nextCursor" class="center">
    <button :disabled="loading" @click="load({ append: true })">
      {{ loading ? 'Loading…' : 'Load more' }}
    </button>
  </p>
</template>
