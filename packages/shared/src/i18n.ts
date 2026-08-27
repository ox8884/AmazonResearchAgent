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
  | 'languageEnglish'
  | 'totalImports'
  | 'totalCandidates'
  | 'acceptedLabel'
  | 'rejectedLabel'
  | 'uniqueKeywords'
  | 'duplicateKeywords'
  | 'recentCandidates'
  | 'recentImports'
  | 'noImports'
  | 'noCandidates'
  | 'fileCount'
  | 'rowCount'
  | 'createdAt'
  | 'statusLabel'
  | 'selectedFiles'
  | 'uploadingFiles'
  | 'uploadSuccess'
  | 'uploadError'
  | 'returnToImports'
  | 'importIdLabel'
  | 'privacyNote'
  | 'viewAllImports'
  | 'skipToContent'
  | 'technicalDetails'
  | 'showcaseTitle'
  | 'dataUnavailable'
  | 'showcaseActions'
  | 'showcaseStatus'
  | 'showcaseMetrics'
  | 'showcaseStates'
  | 'uploadTooMany'
  | 'uploadTooLarge'
  | 'uploadInvalidFile'
  | 'navAiSettings'
  | 'aiSettingsTitle'
  | 'aiSettingsDescription'
  | 'providerName'
  | 'billingType'
  | 'providerKind'
  | 'baseUrl'
  | 'apiKey'
  | 'modelId'
  | 'executable'
  | 'fixedArgs'
  | 'networkScope'
  | 'commandProfile'
  | 'saveProvider'
  | 'testConnection'
  | 'providerSaved'
  | 'secretStored'
  | 'connectionReady'
  | 'connectionUnavailable'
  | 'noProviders'
  | 'roleAssignments'
  | 'providerEnabled'
  | 'adminLoginTitle'
  | 'adminPassword'
  | 'adminLogin'
  | 'adminLogout'
  | 'invalidLogin';

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
    languageEnglish: 'English',
    totalImports: '전체 가져오기',
    totalCandidates: '전체 후보',
    acceptedLabel: 'AI Screening 대상',
    rejectedLabel: 'Reject',
    uniqueKeywords: '고유 키워드',
    duplicateKeywords: '중복 키워드',
    recentCandidates: '최근 후보',
    recentImports: '최근 가져오기',
    noImports: '아직 가져온 파일이 없습니다.',
    noCandidates: '아직 평가된 후보가 없습니다.',
    fileCount: '파일',
    rowCount: '원본 행',
    createdAt: '생성 시각',
    statusLabel: '상태',
    selectedFiles: '선택한 파일',
    uploadingFiles: '파일을 업로드하고 작업을 등록합니다…',
    uploadSuccess: '가져오기가 등록되었습니다. Worker가 백그라운드에서 처리합니다.',
    uploadError: '가져오기를 등록하지 못했습니다. 파일을 확인하고 다시 시도하세요.',
    returnToImports: '가져오기 목록으로 돌아가기',
    importIdLabel: 'Import run ID',
    privacyNote: '파일은 private Storage에 저장하며 서버 자격 증명은 브라우저에 노출하지 않습니다.',
    viewAllImports: '모든 가져오기 보기',
    skipToContent: '본문으로 건너뛰기',
    technicalDetails: '기술 세부 정보',
    showcaseTitle: 'UI primitive 검증',
    dataUnavailable: '데이터베이스 연결이 아직 설정되지 않아 빈 대시보드를 표시합니다.',
    showcaseActions: '동작',
    showcaseStatus: '상태',
    showcaseMetrics: '지표',
    showcaseStates: '폼 / 빈 상태 / 오류',
    uploadTooMany: 'CSV 파일은 최대 20개까지만 선택하세요.',
    uploadTooLarge: '각 CSV 파일은 10 MB 이하여야 합니다.',
    uploadInvalidFile: '비어 있지 않은 CSV 파일만 선택할 수 있습니다.',
    navAiSettings: 'AI 설정',
    aiSettingsTitle: 'AI Provider 설정',
    aiSettingsDescription: 'AI provider를 추가하고 역할별 실행 경로를 관리합니다.',
    providerName: 'Provider name',
    billingType: 'Billing type',
    providerKind: 'Provider kind',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    modelId: 'Model ID',
    executable: 'Command executable',
    fixedArgs: 'Fixed arguments (JSON array)',
    networkScope: 'Network scope',
    commandProfile: 'Command profile',
    saveProvider: '저장',
    testConnection: '연결 테스트',
    providerSaved: 'Provider 설정을 저장했습니다.',
    secretStored: '저장된 key',
    connectionReady: 'Provider 연결 가능',
    connectionUnavailable: 'Provider 연결 불가',
    noProviders: '저장된 provider가 없습니다.',
    roleAssignments: 'Role assignments',
    providerEnabled: 'Provider enabled',
    adminLoginTitle: '관리자 로그인',
    adminPassword: '관리자 비밀번호',
    adminLogin: '로그인',
    adminLogout: '로그아웃',
    invalidLogin: '로그인 정보가 올바르지 않습니다.'
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
    languageEnglish: 'English',
    totalImports: 'Total imports',
    totalCandidates: 'Total candidates',
    acceptedLabel: 'Accepted for AI Screening',
    rejectedLabel: 'Reject',
    uniqueKeywords: 'Unique keywords',
    duplicateKeywords: 'Duplicate keywords',
    recentCandidates: 'Recent candidates',
    recentImports: 'Recent imports',
    noImports: 'No files have been imported yet.',
    noCandidates: 'No candidates have been evaluated yet.',
    fileCount: 'Files',
    rowCount: 'Raw rows',
    createdAt: 'Created',
    statusLabel: 'Status',
    selectedFiles: 'Selected files',
    uploadingFiles: 'Securely uploading files and enqueueing the job…',
    uploadSuccess: 'Import queued. The worker will process it in the background.',
    uploadError: 'The import could not be queued. Check the files and try again.',
    returnToImports: 'Return to imports',
    importIdLabel: 'Import run ID',
    privacyNote: 'Files are stored in private Storage; server credentials are never exposed to the browser.',
    viewAllImports: 'View all imports',
    skipToContent: 'Skip to content',
    technicalDetails: 'Technical details',
    showcaseTitle: 'UI primitive verification',
    dataUnavailable: 'The database connection is not configured yet, so the dashboard is shown empty.',
    showcaseActions: 'Actions',
    showcaseStatus: 'Status',
    showcaseMetrics: 'Metrics',
    showcaseStates: 'Form / empty / error',
    uploadTooMany: 'Choose no more than 20 CSV files.',
    uploadTooLarge: 'Each CSV file must be no larger than 10 MB.',
    uploadInvalidFile: 'Choose non-empty CSV files only.',
    navAiSettings: 'AI settings',
    aiSettingsTitle: 'AI provider settings',
    aiSettingsDescription: 'Add providers and manage role-specific execution routes.',
    providerName: 'Provider name',
    billingType: 'Billing type',
    providerKind: 'Provider kind',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    modelId: 'Model ID',
    executable: 'Command executable',
    fixedArgs: 'Fixed arguments (JSON array)',
    networkScope: 'Network scope',
    commandProfile: 'Command profile',
    saveProvider: 'Save',
    testConnection: 'Test connection',
    providerSaved: 'Provider settings saved.',
    secretStored: 'Stored key',
    connectionReady: 'Provider available',
    connectionUnavailable: 'Provider unavailable',
    noProviders: 'No providers have been saved.',
    roleAssignments: 'Role assignments',
    providerEnabled: 'Provider enabled',
    adminLoginTitle: 'Admin login',
    adminPassword: 'Admin password',
    adminLogin: 'Log in',
    adminLogout: 'Log out',
    invalidLogin: 'The login credentials are invalid.'
  }
} as const satisfies Record<Locale, CopyDictionary>;

export function getCopy(locale: Locale): CopyDictionary {
  return COPY[locale];
}
