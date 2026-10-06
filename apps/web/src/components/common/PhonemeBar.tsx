export interface PhonemeSegment {
  text: string;
  accuracy: number;
  start?: number;
  end?: number;
}

interface PhonemeBarProps {
  segments: PhonemeSegment[];
}

function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 80) return 'bg-success-500';
  if (accuracy >= 60) return 'bg-warning-500';
  return 'bg-danger-500';
}

function getAccuracyBg(accuracy: number): string {
  if (accuracy >= 80) return 'bg-success-50 text-success-700';
  if (accuracy >= 60) return 'bg-warning-50 text-warning-700';
  return 'bg-danger-50 text-danger-700';
}

export function PhonemeBar({ segments }: PhonemeBarProps) {
  if (segments.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Colored segments */}
      <div className="flex gap-1">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`h-6 rounded-sm ${getAccuracyColor(seg.accuracy)}`}
            style={{
              flex: Math.max(1, seg.text.length),
              minWidth: '1.5rem',
            }}
            title={`${seg.text}: ${seg.accuracy}%`}
          />
        ))}
      </div>

      {/* Phoneme labels */}
      <div className="flex gap-1">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`rounded-md px-1.5 py-0.5 text-center text-xs font-semibold ${getAccuracyBg(seg.accuracy)}`}
            style={{
              flex: Math.max(1, seg.text.length),
              minWidth: '1.5rem',
            }}
          >
            {seg.text}
          </div>
        ))}
      </div>
    </div>
  );
}
