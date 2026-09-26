export const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'ta', label: 'தமிழ்' },
  { value: 'hi', label: 'हिंदी' },
] as const;

export type UiLanguage = (typeof languageOptions)[number]['value'];

export const uiText: Record<UiLanguage, {
  questionLabel: string;
  answerLabel: string;
  readAloud: string;
  languageLabel: string;
  micLabel: string;
}> = {
  en: {
    questionLabel: 'Your question',
    answerLabel: 'Grounded answer',
    readAloud: 'Read aloud',
    languageLabel: 'Language',
    micLabel: 'Use microphone',
  },
  ta: {
    questionLabel: 'உங்கள் கேள்வி',
    answerLabel: 'ஆதாரமுள்ள பதில்',
    readAloud: 'ஒலியாக வாசி',
    languageLabel: 'மொழி',
    micLabel: 'மைக்ரோஃபோன் பயன்படுத்தவும்',
  },
  hi: {
    questionLabel: 'आपका प्रश्न',
    answerLabel: 'संदर्भित उत्तर',
    readAloud: 'उच्चारित सुनाएँ',
    languageLabel: 'भाषा',
    micLabel: 'माइक्रोफ़ोन उपयोग करें',
  },
};
