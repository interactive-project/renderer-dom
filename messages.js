const catalogs = Object.freeze({
  en: Object.freeze({
    'host.loading': 'Loading activity…',
    'host.validation-error': 'This activity is invalid and cannot be displayed.',
    'host.runtime-error': 'The activity could not be started.',
    'host.unsupported-engine': 'No engine is registered for this activity version.',
    'host.unsupported-renderer': 'No DOM renderer is registered for this activity version.',
    'renderer.rendering': 'Rendering activity…',
    'content.invalid': 'This content is invalid and cannot be displayed.',
    'content.unavailable': 'This content could not be displayed.',
    'quiz.title': 'Quiz',
    'quiz.no-questions': 'This quiz has no questions.',
    'quiz.start': 'Start quiz',
    'quiz.checking': 'Checking your answers…',
    'quiz.complete': 'Quiz complete.',
    'quiz.checked': 'Your answers have been checked.',
    'quiz.finish': 'Finish quiz',
    'quiz.navigation': 'Quiz questions',
    'quiz.question-position': 'Question {current} of {total}',
    'quiz.question-button': 'Question {current}',
    'quiz.true': 'True',
    'quiz.false': 'False',
    'quiz.submit': 'Submit answers',
    'quiz.unsupported-question': 'This question type is not supported by the DOM renderer yet.',
    'action.unavailable': 'That action is not available in the current activity state.',
    'action.failed': 'That action could not be applied.',
    'flashcards.title': 'Flashcards',
    'flashcards.start': 'Start study',
    'flashcards.resume': 'Resume study',
    'flashcards.start-failed': 'The study session could not be started.',
    'flashcards.resume-failed': 'The study session could not be resumed.',
    'flashcards.complete': 'Study complete.',
    'flashcards.invalid-deck': 'This flashcard deck is invalid.',
    'flashcards.front': 'Front',
    'flashcards.back': 'Back',
    'flashcards.rate-again': 'Rate again',
    'flashcards.rate-hard': 'Rate hard',
    'flashcards.rate-good': 'Rate good',
    'flashcards.rate-easy': 'Rate easy',
    'flashcards.acknowledge': 'Mark reviewed without rating',
    'flashcards.reveal': 'Reveal answer',
    'flashcards.progress': '{reviewed} of {total} reviewed.',
    'flashcards.no-cards': 'There are no cards to study.',
    'flashcards.finish': 'Finish study',
    'flashcards.next': 'Next card'
  }),
  es: Object.freeze({
    'host.loading': 'Cargando actividad…',
    'host.validation-error': 'Esta actividad no es válida y no se puede mostrar.',
    'host.runtime-error': 'No se pudo iniciar la actividad.',
    'host.unsupported-engine': 'No hay un motor registrado para esta versión de la actividad.',
    'host.unsupported-renderer': 'No hay un renderizador DOM registrado para esta versión de la actividad.',
    'renderer.rendering': 'Mostrando actividad…',
    'content.invalid': 'Este contenido no es válido y no se puede mostrar.',
    'content.unavailable': 'No se pudo mostrar este contenido.',
    'quiz.title': 'Cuestionario',
    'quiz.no-questions': 'Este cuestionario no tiene preguntas.',
    'quiz.start': 'Empezar cuestionario',
    'quiz.checking': 'Comprobando tus respuestas…',
    'quiz.complete': 'Cuestionario completado.',
    'quiz.checked': 'Se han comprobado tus respuestas.',
    'quiz.finish': 'Finalizar cuestionario',
    'quiz.navigation': 'Preguntas del cuestionario',
    'quiz.question-position': 'Pregunta {current} de {total}',
    'quiz.question-button': 'Pregunta {current}',
    'quiz.true': 'Verdadero',
    'quiz.false': 'Falso',
    'quiz.submit': 'Enviar respuestas',
    'quiz.unsupported-question': 'El renderizador DOM aún no admite este tipo de pregunta.',
    'action.unavailable': 'Esa acción no está disponible en el estado actual de la actividad.',
    'action.failed': 'No se pudo aplicar esa acción.',
    'flashcards.title': 'Tarjetas de estudio',
    'flashcards.start': 'Empezar estudio',
    'flashcards.resume': 'Reanudar estudio',
    'flashcards.start-failed': 'No se pudo iniciar la sesión de estudio.',
    'flashcards.resume-failed': 'No se pudo reanudar la sesión de estudio.',
    'flashcards.complete': 'Estudio completado.',
    'flashcards.invalid-deck': 'Este mazo de tarjetas no es válido.',
    'flashcards.front': 'Anverso',
    'flashcards.back': 'Reverso',
    'flashcards.rate-again': 'Marcar para repetir',
    'flashcards.rate-hard': 'Marcar difícil',
    'flashcards.rate-good': 'Marcar bien',
    'flashcards.rate-easy': 'Marcar fácil',
    'flashcards.acknowledge': 'Marcar como repasada sin valoración',
    'flashcards.reveal': 'Mostrar respuesta',
    'flashcards.progress': '{reviewed} de {total} repasadas.',
    'flashcards.no-cards': 'No hay tarjetas para estudiar.',
    'flashcards.finish': 'Finalizar estudio',
    'flashcards.next': 'Siguiente tarjeta'
  }),
  ar: Object.freeze({
    'host.loading': 'جارٍ تحميل النشاط…',
    'host.validation-error': 'هذا النشاط غير صالح ولا يمكن عرضه.',
    'host.runtime-error': 'تعذّر بدء النشاط.',
    'host.unsupported-engine': 'لا يوجد محرّك مسجّل لهذا الإصدار من النشاط.',
    'host.unsupported-renderer': 'لا يوجد عارض DOM مسجّل لهذا الإصدار من النشاط.',
    'renderer.rendering': 'جارٍ عرض النشاط…',
    'content.invalid': 'هذا المحتوى غير صالح ولا يمكن عرضه.',
    'content.unavailable': 'تعذّر عرض هذا المحتوى.',
    'quiz.title': 'اختبار',
    'quiz.no-questions': 'لا توجد أسئلة في هذا الاختبار.',
    'quiz.start': 'بدء الاختبار',
    'quiz.checking': 'جارٍ التحقق من إجاباتك…',
    'quiz.complete': 'اكتمل الاختبار.',
    'quiz.checked': 'تم التحقق من إجاباتك.',
    'quiz.finish': 'إنهاء الاختبار',
    'quiz.navigation': 'أسئلة الاختبار',
    'quiz.question-position': 'السؤال {current} من {total}',
    'quiz.question-button': 'السؤال {current}',
    'quiz.true': 'صحيح',
    'quiz.false': 'خطأ',
    'quiz.submit': 'إرسال الإجابات',
    'quiz.unsupported-question': 'نوع السؤال هذا غير مدعوم بعد في عارض DOM.',
    'action.unavailable': 'هذا الإجراء غير متاح في الحالة الحالية للنشاط.',
    'action.failed': 'تعذّر تنفيذ هذا الإجراء.',
    'flashcards.title': 'بطاقات تعليمية',
    'flashcards.start': 'بدء الدراسة',
    'flashcards.resume': 'استئناف الدراسة',
    'flashcards.start-failed': 'تعذّر بدء جلسة الدراسة.',
    'flashcards.resume-failed': 'تعذّر استئناف جلسة الدراسة.',
    'flashcards.complete': 'اكتملت الدراسة.',
    'flashcards.invalid-deck': 'مجموعة البطاقات غير صالحة.',
    'flashcards.front': 'الوجه الأمامي',
    'flashcards.back': 'الوجه الخلفي',
    'flashcards.rate-again': 'التقييم: أعد المحاولة',
    'flashcards.rate-hard': 'التقييم: صعب',
    'flashcards.rate-good': 'التقييم: جيد',
    'flashcards.rate-easy': 'التقييم: سهل',
    'flashcards.acknowledge': 'تحديد تمت المراجعة دون تقييم',
    'flashcards.reveal': 'إظهار الإجابة',
    'flashcards.progress': 'تمت مراجعة {reviewed} من {total}.',
    'flashcards.no-cards': 'لا توجد بطاقات للدراسة.',
    'flashcards.finish': 'إنهاء الدراسة',
    'flashcards.next': 'البطاقة التالية'
  })
});

const rtlLanguages = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);

export function preferredLocale(locales = []) {
  return typeof locales[0] === 'string' && locales[0] ? locales[0] : 'en';
}

export function directionForLocale(locale) {
  const language = String(locale ?? 'en').toLowerCase().split(/[-_]/, 1)[0];
  return rtlLanguages.has(language) ? 'rtl' : 'ltr';
}

export function message(key, locales, localize, values = {}) {
  const locale = preferredLocale(locales);
  const language = locale.toLowerCase().split(/[-_]/, 1)[0];
  const fallback = catalogs[language]?.[key] ?? catalogs.en[key] ?? key;
  let value = fallback;
  if (typeof localize === 'function') {
    try {
      const translated = localize(`renderer-dom.${key}`, locale);
      if (typeof translated === 'string' && translated.length > 0) value = translated;
    } catch { /* Keep the bundled locale fallback when a host catalog fails. */ }
  }
  return value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) => (
    Object.hasOwn(values, name) ? String(values[name]) : match
  ));
}
