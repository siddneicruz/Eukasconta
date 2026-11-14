import React from 'react';

// Carinhas planas de satisfação (desenho original). 5 níveis: 2/4/6/8/10.
const LEVELS: { max: number; color: string; mouth: React.ReactNode }[] = [
  { max: 3, color: '#E0202B', mouth: <path d="M7.5 17.5c1-3.2 2.8-4.2 4.5-4.2s3.5 1 4.5 4.2z" fill="#fff" /> },
  { max: 5, color: '#EF6C2B', mouth: <path d="M8 16.8c1.2-2 2.5-2.8 4-2.8s2.8.8 4 2.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /> },
  { max: 7, color: '#F5A623', mouth: <path d="M8 15.5h8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /> },
  { max: 9, color: '#8CC152', mouth: <path d="M8 14c1.2 2 2.5 2.8 4 2.8s2.8-.8 4-2.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /> },
  { max: 11, color: '#22A04B', mouth: <path d="M7.3 13.2h9.4c-.6 3.4-2.4 5-4.7 5s-4.1-1.6-4.7-5z" fill="#fff" /> },
];

export const faceColor = (score: number) => (LEVELS.find(l => score < l.max) || LEVELS[4]).color;

export const QualityFace: React.FC<{ score: number; size?: number; className?: string }> = ({ score, size = 20, className }) => {
  const l = LEVELS.find(x => score < x.max) || LEVELS[4];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={{ display: 'inline-block', verticalAlign: 'middle' }} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill={l.color} />
      <circle cx="8.3" cy="9" r="1.5" fill="#fff" />
      <circle cx="15.7" cy="9" r="1.5" fill="#fff" />
      {l.mouth}
    </svg>
  );
};
