import { PROJECT_URL, ISSUES_URL } from '@/shared/config/extension';

export const popupLinks = [
  { label: '문제 신고', href: `${ISSUES_URL}/new?template=bug.yml`, icon: 'issue' },
  { label: '문의, 제안', href: `${ISSUES_URL}/new?template=feature.yml`, icon: 'message' },
  { label: 'GitHub', href: PROJECT_URL, icon: 'github' },
] as const;
