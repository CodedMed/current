import type { AdvisorLanguage } from '../../../../shared/copilot.ts';
import type { VoiceState } from './voiceState.ts';

/**
 * The few interface strings the advisor page needs in both supported languages. The advisor's
 * own answers are produced in the selected language by the intelligence service; this only keeps
 * the chrome around them consistent. Not a general i18n system on purpose.
 */
export interface AdvisorStrings {
  title: string;
  tagline: string;
  textMode: string;
  voiceMode: string;
  language: string;
  dashboard: string;
  signOut: string;
  emptyTitle: string;
  emptyBody: string;
  suggestions: string;
  placeholder: string;
  voicePlaceholder: string;
  send: string;
  sending: string;
  thinking: string;
  retry: string;
  headline: string;
  risks: string;
  actions: string;
  actionsHint: string;
  addToTasks: string;
  adding: string;
  added: string;
  dismiss: string;
  dismissed: string;
  undo: string;
  due: string;
  impact: string;
  spokenTurn: string;
  spokenByAgent: string;
  demoAdvisor: string;
  demoAdvisorTitle: string;
  fallbackAdvisor: string;
  gemini: string;
  voiceStates: Record<VoiceState, { label: string; hint: string }>;
  startVoice: string;
  endVoice: string;
  connecting: string;
  tryAgain: string;
  switchToText: string;
  voiceUnavailableTitle: string;
  voiceHow: string;
  voicePrivacy: string;
  voiceTyped: string;
  snapshotTitle: string;
  snapshotSubtitle: string;
  availableCash: string;
  expectedIn: string;
  expectedOut: string;
  net30: string;
  projectedGap: string;
  noGap: string;
  overdue: string;
  openTasks: string;
  snapshotError: string;
  privacyTitle: string;
  privacyBody: string;
  taskAdded: string;
  taskFailed: string;
  voiceStoppedForLanguage: string;
  micMute: string;
  micUnmute: string;
}

export const STRINGS: Record<AdvisorLanguage, AdvisorStrings> = {
  en: {
    title: 'Advisor',
    tagline: 'Cash-flow answers from your own ledger',
    textMode: 'Text',
    voiceMode: 'Voice',
    language: 'Language',
    dashboard: 'Dashboard',
    signOut: 'Sign out',
    emptyTitle: 'Ask about your cash position',
    emptyBody: 'Every answer is grounded in the balances, expected payments, obligations and forecast Keel already computed for your business. Recommendations stay proposals until you add them to your tasks.',
    suggestions: 'Try one of these',
    placeholder: 'Ask about cash, upcoming payments, overdue invoices, or what to do first…',
    voicePlaceholder: 'Type to the voice advisor, or just speak…',
    send: 'Send',
    sending: 'Sending',
    thinking: 'Reviewing your ledger…',
    retry: 'Retry',
    headline: 'Headline',
    risks: 'Risks to watch',
    actions: 'Recommended actions',
    actionsHint: 'Proposals only. Nothing happens until you add one to your tasks.',
    addToTasks: 'Add to tasks',
    adding: 'Adding',
    added: 'Added to your tasks',
    dismiss: 'Dismiss',
    dismissed: 'Dismissed',
    undo: 'Undo',
    due: 'Due',
    impact: 'Est. impact',
    spokenTurn: 'Spoken',
    spokenByAgent: 'Voice agent',
    demoAdvisor: 'Demo advisor',
    demoAdvisorTitle: 'Deterministic answer composed from your ledger figures. Set GEMINI_API_KEY to use Gemini.',
    fallbackAdvisor: 'Gemini unavailable · demo answer',
    gemini: 'Gemini',
    voiceStates: {
      idle: { label: 'Ready', hint: 'Start a conversation and ask about your cash flow out loud.' },
      unavailable: { label: 'Voice unavailable', hint: 'The text advisor keeps working.' },
      connecting: { label: 'Connecting', hint: 'Setting up the voice session…' },
      listening: { label: 'Listening', hint: 'Go ahead, the advisor is listening.' },
      thinking: { label: 'Thinking', hint: 'Checking your ledger and preparing an answer…' },
      speaking: { label: 'Speaking', hint: 'The advisor is answering. You can interrupt at any time.' },
      error: { label: 'Something went wrong', hint: 'Try again, or switch to text.' },
    },
    startVoice: 'Start voice conversation',
    endVoice: 'End conversation',
    connecting: 'Connecting…',
    tryAgain: 'Try again',
    switchToText: 'Switch to text',
    voiceUnavailableTitle: 'Voice is not available',
    voiceHow: 'ElevenLabs handles speech and turn-taking. Every answer is computed by the Keel advisor from your ledger, the same as in text mode.',
    voicePrivacy: 'Only your microphone audio and the advisor’s answers reach the voice service. No documents or account details ever do.',
    voiceTyped: 'Sent to the voice advisor',
    snapshotTitle: 'Your numbers',
    snapshotSubtitle: 'What the advisor reasons over',
    availableCash: 'Available cash',
    expectedIn: 'Expected in · 30d',
    expectedOut: 'Expected out · 30d',
    net30: 'Net · 30d',
    projectedGap: 'Projected gap',
    noGap: 'None inside the horizon',
    overdue: 'Overdue receivables',
    openTasks: 'Open tasks',
    snapshotError: 'Snapshot unavailable',
    privacyTitle: 'How answers are grounded',
    privacyBody: 'The ledger service computes every balance, forecast and risk score. The advisor only explains those figures; it never sees your documents, account numbers, or raw transactions, and it cannot change anything.',
    taskAdded: 'Added to your tasks.',
    taskFailed: 'Could not add that task.',
    voiceStoppedForLanguage: 'Voice conversation ended. Start it again to continue in the new language.',
    micMute: 'Mute microphone',
    micUnmute: 'Unmute microphone',
  },
  es: {
    title: 'Asesor',
    tagline: 'Respuestas de flujo de caja desde tu propio libro mayor',
    textMode: 'Texto',
    voiceMode: 'Voz',
    language: 'Idioma',
    dashboard: 'Panel',
    signOut: 'Cerrar sesión',
    emptyTitle: 'Pregunta sobre tu posición de efectivo',
    emptyBody: 'Cada respuesta se basa en los saldos, pagos esperados, obligaciones y pronóstico que Keel ya calculó para tu negocio. Las recomendaciones son propuestas hasta que las añadas a tus tareas.',
    suggestions: 'Prueba con una de estas',
    placeholder: 'Pregunta sobre efectivo, pagos próximos, facturas vencidas o qué hacer primero…',
    voicePlaceholder: 'Escribe al asesor de voz, o simplemente habla…',
    send: 'Enviar',
    sending: 'Enviando',
    thinking: 'Revisando tu libro mayor…',
    retry: 'Reintentar',
    headline: 'Lo esencial',
    risks: 'Riesgos a vigilar',
    actions: 'Acciones recomendadas',
    actionsHint: 'Solo propuestas. No ocurre nada hasta que añadas una a tus tareas.',
    addToTasks: 'Añadir a tareas',
    adding: 'Añadiendo',
    added: 'Añadida a tus tareas',
    dismiss: 'Descartar',
    dismissed: 'Descartada',
    undo: 'Deshacer',
    due: 'Vence',
    impact: 'Impacto est.',
    spokenTurn: 'Hablado',
    spokenByAgent: 'Agente de voz',
    demoAdvisor: 'Asesor demo',
    demoAdvisorTitle: 'Respuesta determinista compuesta a partir de las cifras de tu libro mayor. Configura GEMINI_API_KEY para usar Gemini.',
    fallbackAdvisor: 'Gemini no disponible · respuesta demo',
    gemini: 'Gemini',
    voiceStates: {
      idle: { label: 'Listo', hint: 'Inicia una conversación y pregunta en voz alta sobre tu flujo de caja.' },
      unavailable: { label: 'Voz no disponible', hint: 'El asesor de texto sigue funcionando.' },
      connecting: { label: 'Conectando', hint: 'Preparando la sesión de voz…' },
      listening: { label: 'Escuchando', hint: 'Adelante, el asesor te escucha.' },
      thinking: { label: 'Pensando', hint: 'Consultando tu libro mayor y preparando una respuesta…' },
      speaking: { label: 'Hablando', hint: 'El asesor está respondiendo. Puedes interrumpir cuando quieras.' },
      error: { label: 'Algo salió mal', hint: 'Inténtalo de nuevo o cambia a texto.' },
    },
    startVoice: 'Iniciar conversación de voz',
    endVoice: 'Terminar conversación',
    connecting: 'Conectando…',
    tryAgain: 'Intentar de nuevo',
    switchToText: 'Cambiar a texto',
    voiceUnavailableTitle: 'La voz no está disponible',
    voiceHow: 'ElevenLabs gestiona el habla y los turnos. Cada respuesta la calcula el asesor de Keel a partir de tu libro mayor, igual que en modo texto.',
    voicePrivacy: 'Solo el audio de tu micrófono y las respuestas del asesor llegan al servicio de voz. Nunca documentos ni datos de cuentas.',
    voiceTyped: 'Enviado al asesor de voz',
    snapshotTitle: 'Tus cifras',
    snapshotSubtitle: 'Sobre lo que razona el asesor',
    availableCash: 'Efectivo disponible',
    expectedIn: 'Entradas · 30 d',
    expectedOut: 'Salidas · 30 d',
    net30: 'Neto · 30 d',
    projectedGap: 'Brecha proyectada',
    noGap: 'Ninguna en el horizonte',
    overdue: 'Cobros vencidos',
    openTasks: 'Tareas abiertas',
    snapshotError: 'Resumen no disponible',
    privacyTitle: 'Cómo se fundamentan las respuestas',
    privacyBody: 'El servicio de libro mayor calcula cada saldo, pronóstico y puntuación de riesgo. El asesor solo explica esas cifras; nunca ve tus documentos, números de cuenta ni transacciones en bruto, y no puede cambiar nada.',
    taskAdded: 'Añadida a tus tareas.',
    taskFailed: 'No se pudo añadir esa tarea.',
    voiceStoppedForLanguage: 'La conversación de voz terminó. Inicia de nuevo para continuar en el nuevo idioma.',
    micMute: 'Silenciar micrófono',
    micUnmute: 'Activar micrófono',
  },
};
