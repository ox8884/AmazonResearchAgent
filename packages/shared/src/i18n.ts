import type { Locale } from './domain';

export const DEFAULT_LOCALE: Locale = 'ko';

export type CopyKey =
  | 'appName'
  | 'navHome'
  | 'navImports'
  | 'homeTitle'
  | 'homeDescription'
  | 'importsTitle'
  | 'importsDescription'
  | 'newImport'
  | 'uploadTitle'
  | 'uploadHelp'
  | 'startImport'
  | 'importQueued'
  | 'importProcessing'
  | 'importCompleted'
  | 'importFailed'
  | 'candidateTitle'
  | 'keywordLabel'
  | 'scoreLabel'
  | 'decisionReasonLabel'
  | 'languageKorean'
  | 'languageEnglish';

type CopyDictionary = Record<CopyKey, string>;

export const COPY = {
  ko: {
    appName: 'Amazon Research Agent',
    navHome: '홈',
    navImports: '가져오기',
    homeTitle: 'Kitchen & Dining 기회 연구',
    homeDescription: '저비용 발견과 검증 가능한 결정 기록을 한곳에서 관리합니다.',
    importsTitle: 'Opportunity Finder 가져오기',
    importsDescription: 'Jungle Scout Opportunity Finder CSV를 병합하고 API 호출 없이 1차 평가합니다.',
    newImport: '새 가져오기',
    uploadTitle: 'CSV 파일 업로드',
    uploadHelp: '최대 20개, 파일당 10 MB 이하의 CSV 파일을 선택하세요.',
    startImport: '가져오기 시작',
    importQueued: '처리 대기',
    importProcessing: '처리 중',
    importCompleted: '완료',
    importFailed: '실패',
    candidateTitle: '후보',
    keywordLabel: '키워드',
    scoreLabel: 'Preliminary Score',
    decisionReasonLabel: '결정 사유',
    languageKorean: '한국어',
    languageEnglish: 'English'
  },
  en: {
    appName: 'Amazon Research Agent',
    navHome: 'Home',
    navImports: 'Imports',
    homeTitle: 'Kitchen & Dining Opportunity Research',
    homeDescription: 'Manage low-cost discovery and auditable decisions in one place.',
    importsTitle: 'Opportunity Finder Imports',
    importsDescription: 'Merge Jungle Scout Opportunity Finder CSV files and evaluate them without API calls.',
    newImport: 'New import',
    uploadTitle: 'Upload CSV files',
    uploadHelp: 'Choose up to 20 CSV files, each no larger than 10 MB.',
    startImport: 'Start import',
    importQueued: 'Queued',
    importProcessing: 'Processing',
    importCompleted: 'Completed',
    importFailed: 'Failed',
    candidateTitle: 'Candidates',
    keywordLabel: 'Keyword',
    scoreLabel: 'Preliminary Score',
    decisionReasonLabel: 'Decision reason',
    languageKorean: '한국어',
    languageEnglish: 'English'
  }
} as const satisfies Record<Locale, CopyDictionary>;

export function getCopy(locale: Locale): CopyDictionary {
  return COPY[locale];
}
