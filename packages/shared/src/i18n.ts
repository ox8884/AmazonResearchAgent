import type { Locale } from './domain';

export const AI_PROVIDER_PRODUCT_OPTIONS = [
  { value: 'codex_subscription', label: 'OpenAI Codex Subscription' },
  { value: 'grok_subscription', label: 'Grok Subscription' },
  { value: 'openai_compatible_api', label: 'OpenAI-Compatible API' }
] as const;

export type AiProviderProduct = typeof AI_PROVIDER_PRODUCT_OPTIONS[number]['value'];

export function aiProviderProductFields(product: AiProviderProduct) {
  const isHttp = product === 'openai_compatible_api';
  return {
    httpCredentials: isHttp,
    modelConfiguration: isHttp,
    roleSelection: isHttp,
    activation: isHttp
  } as const;
}

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
  | 'navResearchGroup'
  | 'aiSettingsTitle'
  | 'aiSettingsDescription'
  | 'providerName'
  | 'billingType'
  | 'providerKind'
  | 'providerProduct'
  | 'baseUrl'
  | 'apiKey'
  | 'modelId'
  | 'executable'
  | 'fixedArgs'
  | 'networkScope'
  | 'commandProfile'
  | 'saveProvider'
  | 'savingProvider'
  | 'newOpenAiProvider'
  | 'savedProviders'
  | 'editProvider'
  | 'testConnection'
  | 'testingConnection'
  | 'disableProvider'
  | 'subscriptionLabel'
  | 'subscriptionRole'
  | 'subscriptionModel'
  | 'subscriptionStatus'
  | 'lastProbe'
  | 'setupRequired'
  | 'authorizationExpired'
  | 'probePending'
  | 'temporarilyUnavailable'
  | 'providerDisabled'
  | 'operatorAuthorizationGuidance'
  | 'httpTestCostWarning'
  | 'providerSaved'
  | 'secretStored'
  | 'connectionReady'
  | 'connectionUnavailable'
  | 'connectionResponseInvalid'
  | 'connectionRequestRejected'
  | 'noProviders'
  | 'roleAssignments'
  | 'providerEnabled'
  | 'providerPriority'
  | 'modelEnabled'
  | 'modelPriority'
  | 'adminLoginTitle'
  | 'adminPassword'
  | 'adminLogin'
  | 'adminLogout'
  | 'invalidLogin'
  | 'researchNow'
  | 'researchNowQueued'
  | 'researchNowError'
  | 'navDashboard'
  | 'competitionLabel'
  | 'navCandidates'
  | 'navRuns'
  | 'navSettings'
  | 'candidatesTitle'
  | 'runsTitle'
  | 'settingsTitle'
  | 'settingsLocale'
  | 'settingsTimezone'
  | 'settingsAllocation'
  | 'settingsManualReserve'
  | 'settingsReadOnly'
  | 'queuedLabel'
  | 'runningLabel'
  | 'waitingLabel'
  | 'completedLabel'
  | 'apiBudgetLabel'
  | 'demandLabel'
  | 'marginLabel'
  | 'differentiationLabel'
  | 'noRuns'
  | 'waitingBudgetLabel'
  | 'needsAttentionLabel'
  | 'providerActive'
  | 'reserveLabel'
  | 'evidenceLabel'
  | 'noEvidence'
  | 'runPlanningLabel'
  | 'runFanoutLabel'
  | 'failedLabel'
  | 'sourceScheduled'
  | 'sourceManual'
  | 'stateDiscovered'
  | 'stateRuleFilter'
  | 'stateAiScreening'
  | 'stateReadyForApiValidation'
  | 'stateWaitingForApiBudget'
  | 'stateApiValidationRunning'
  | 'stateDeepResearch'
  | 'stateStrong'
  | 'stateWatch'
  | 'stateReject'
  | 'stateNeedsReview'
  | 'stateWaitingForAiCapacity'
  | 'stateNeedsAttention'
  | 'researchNowOverride'
  | 'researchNowOverrideConfirm';

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
    navResearchGroup: '리서치 운영',
    aiSettingsTitle: 'AI Provider 설정',
    aiSettingsDescription: '구독 Provider와 OpenAI-compatible API를 제품 단위로 안전하게 관리합니다.',
    providerName: 'Provider 이름',
    billingType: '결제 방식',
    providerKind: 'Provider 종류',
    providerProduct: 'AI 제품',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    modelId: 'Model ID',
    executable: 'Command executable',
    fixedArgs: 'Fixed arguments (JSON array)',
    networkScope: 'Network scope',
    commandProfile: 'Command profile',
    saveProvider: '저장',
    savingProvider: '저장 중…',
    newOpenAiProvider: '새 OpenAI 호환 Provider',
    savedProviders: '저장된 Provider',
    editProvider: '수정',
    testConnection: '연결 테스트',
    testingConnection: '테스트 중…',
    disableProvider: '비활성화',
    subscriptionLabel: 'Subscription',
    subscriptionRole: '고정 역할',
    subscriptionModel: '모델',
    subscriptionStatus: '권한 상태',
    lastProbe: '마지막 상태 확인',
    setupRequired: '설정 필요',
    authorizationExpired: '재인증 필요',
    probePending: '상태 확인 대기',
    temporarilyUnavailable: '일시적으로 사용할 수 없음',
    providerDisabled: '비활성화됨',
    operatorAuthorizationGuidance: '운영 서버에서 승인된 절차로 인증 또는 재인증하세요. 브라우저에서는 계정 인증이나 활성화를 수행하지 않습니다.',
    httpTestCostWarning: '연결 테스트는 실제 completion을 실행할 수 있으며 API quota 또는 비용을 사용할 수 있습니다.',
    providerSaved: 'Provider 설정을 저장했습니다.',
    secretStored: '저장된 key',
    connectionReady: 'Provider 연결 가능',
    connectionUnavailable: 'Provider 연결 불가',
    connectionResponseInvalid: 'Provider 응답 형식 확인 필요',
    connectionRequestRejected: 'Provider가 연결 요청을 거부함',
    noProviders: '저장된 provider가 없습니다.',
    roleAssignments: 'Role assignments',
    providerEnabled: 'Provider enabled',
    providerPriority: 'Provider priority',
    modelEnabled: 'Model enabled',
    modelPriority: 'Model priority',
    adminLoginTitle: '관리자 로그인',
    adminPassword: '관리자 비밀번호',
    adminLogin: '로그인',
    adminLogout: '로그아웃',
    invalidLogin: '로그인 정보가 올바르지 않습니다.',
    researchNow: '지금 리서치',
    researchNowQueued: '대기열에 추가됨',
    researchNowError: '리서치를 대기열에 넣지 못했습니다.',
    navDashboard: '대시보드',
    competitionLabel: '경쟁도',
    navCandidates: '후보',
    settingsTitle: '리서치 설정',
    settingsLocale: '언어',
    settingsTimezone: '시간대',
    settingsAllocation: '후보군별 API 배분',
    settingsManualReserve: '수동 예약분',
    settingsReadOnly: '이 화면은 읽기 전용입니다. 운영 설정은 승인된 서버 절차로 관리합니다.',
    navRuns: '실행',
    navSettings: '설정',
    candidatesTitle: '후보 목록',
    runsTitle: '리서치 실행',
    queuedLabel: '대기',
    runningLabel: '실행 중',
    waitingLabel: '대기 중',
    completedLabel: '완료',
    apiBudgetLabel: 'API 예산',
    demandLabel: '수요',
    marginLabel: '마진',
    differentiationLabel: '차별화',
    noRuns: '아직 리서치 실행이 없습니다.',
    waitingBudgetLabel: 'API 예산 대기',
    needsAttentionLabel: '확인 필요',
    providerActive: '활성',
    reserveLabel: '예약분',
    evidenceLabel: '수집 근거',
    noEvidence: '아직 수집된 근거가 없습니다.',
    runPlanningLabel: '계획 중',
    runFanoutLabel: '작업 분배 중',
    failedLabel: '실패',
    sourceScheduled: '예약 실행',
    sourceManual: '수동 실행',
    stateDiscovered: '발견됨',
    stateRuleFilter: '규칙 필터',
    stateAiScreening: 'AI 선별',
    stateReadyForApiValidation: 'API 검증 준비',
    stateWaitingForApiBudget: 'API 예산 대기',
    stateApiValidationRunning: 'API 검증 중',
    stateDeepResearch: '심층 리서치',
    stateStrong: '강한 후보',
    stateWatch: '관찰',
    stateReject: '제외',
    stateNeedsReview: '검토 필요',
    stateWaitingForAiCapacity: 'AI 용량 대기',
    stateNeedsAttention: '확인 필요',
    researchNowOverride: '예약 예산 사용',
    researchNowOverrideConfirm: '예약 API 예산을 사용해서 지금 리서치를 실행할까요?'
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
    navResearchGroup: 'Research operations',
    aiSettingsTitle: 'AI provider settings',
    aiSettingsDescription: 'Manage subscription providers and OpenAI-compatible APIs as product choices.',
    providerName: 'Provider name',
    billingType: 'Billing type',
    providerKind: 'Provider kind',
    providerProduct: 'AI product',
    baseUrl: 'Base URL',
    apiKey: 'API Key',
    modelId: 'Model ID',
    executable: 'Command executable',
    fixedArgs: 'Fixed arguments (JSON array)',
    networkScope: 'Network scope',
    commandProfile: 'Command profile',
    saveProvider: 'Save',
    savingProvider: 'Saving…',
    newOpenAiProvider: 'New OpenAI-Compatible Provider',
    savedProviders: 'Saved providers',
    editProvider: 'Edit',
    testConnection: 'Test connection',
    testingConnection: 'Testing…',
    disableProvider: 'Disable',
    subscriptionLabel: 'Subscription',
    subscriptionRole: 'Fixed role',
    subscriptionModel: 'Model',
    subscriptionStatus: 'Authorization status',
    lastProbe: 'Last health check',
    setupRequired: 'Setup Required',
    authorizationExpired: 'Reauthorization Required',
    probePending: 'Probe Pending',
    temporarilyUnavailable: 'Temporarily Unavailable',
    providerDisabled: 'Disabled',
    operatorAuthorizationGuidance: 'Authorize or reauthorize through the approved operator procedure on the worker host. The browser never authenticates accounts or activates subscription access.',
    httpTestCostWarning: 'Test Connection can issue a real completion and consume API quota or cost.',
    providerSaved: 'Provider settings saved.',
    secretStored: 'Stored key',
    connectionReady: 'Provider available',
    connectionUnavailable: 'Provider unavailable',
    connectionResponseInvalid: 'Provider response format needs attention',
    connectionRequestRejected: 'Provider rejected the connection request',
    noProviders: 'No providers have been saved.',
    roleAssignments: 'Role assignments',
    providerEnabled: 'Provider enabled',
    providerPriority: 'Provider priority',
    modelEnabled: 'Model enabled',
    modelPriority: 'Model priority',
    adminLoginTitle: 'Admin login',
    adminPassword: 'Admin password',
    adminLogin: 'Log in',
    adminLogout: 'Log out',
    invalidLogin: 'The login credentials are invalid.',
    researchNow: 'Research Now',
    researchNowQueued: 'Added to queue',
    researchNowError: 'Research could not be queued.',
    navDashboard: 'Dashboard',
    competitionLabel: 'Competition',
    navCandidates: 'Candidates',
    navRuns: 'Runs',
    navSettings: 'Settings',
    candidatesTitle: 'Candidates',
    runsTitle: 'Research runs',
    settingsTitle: 'Research settings',
    queuedLabel: 'Queued',
    runningLabel: 'Running',
    waitingLabel: 'Waiting',
    completedLabel: 'Completed',
    apiBudgetLabel: 'API budget',
    demandLabel: 'Demand',
    marginLabel: 'Margin',
    differentiationLabel: 'Differentiation',
    noRuns: 'No research runs yet.',
    waitingBudgetLabel: 'Waiting for API Budget',
    needsAttentionLabel: 'Needs Attention',
    providerActive: 'Active',
    settingsLocale: 'Locale',
    settingsTimezone: 'Timezone',
    settingsAllocation: 'API allocation by cohort',
    settingsManualReserve: 'Manual reserve',
    settingsReadOnly: 'Read-only view. Operational settings are managed through the approved server procedure.',
    reserveLabel: 'Reserved',
    evidenceLabel: 'Evidence collected',
    noEvidence: 'No evidence has been collected yet.',
    runPlanningLabel: 'Planning',
    runFanoutLabel: 'Fan-out',
    failedLabel: 'Failed',
    sourceScheduled: 'Scheduled run',
    sourceManual: 'Manual run',
    stateDiscovered: 'Discovered',
    stateRuleFilter: 'Rule filter',
    stateAiScreening: 'AI screening',
    stateReadyForApiValidation: 'Ready for API validation',
    stateWaitingForApiBudget: 'Waiting for API budget',
    stateApiValidationRunning: 'API validation running',
    stateDeepResearch: 'Deep research',
    stateStrong: 'Strong',
    stateWatch: 'Watch',
    stateReject: 'Reject',
    stateNeedsReview: 'Needs review',
    stateWaitingForAiCapacity: 'Waiting for AI capacity',
    stateNeedsAttention: 'Needs attention',
    researchNowOverride: 'Use reserved budget',
    researchNowOverrideConfirm: 'Run Research Now using the reserved API budget?'
  }
} as const satisfies Record<Locale, CopyDictionary>;

export function getCopy(locale: Locale): CopyDictionary {
  return COPY[locale];
}
