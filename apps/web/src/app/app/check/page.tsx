import { PageHeader } from '@/components/ui';
import { CheckForm } from './check-form';

export const metadata = { title: '표현 점검' };

export default function CheckPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="발행 전 표현 점검" description="규칙·기본 탐지기로 빠르게 확인합니다. 입력한 문안은 저장하지 않고 점검 기록(해시·결과)만 남습니다. 중국어 자연스러움·제목과 본문의 관계를 평가하는 AI 교정은 아직 제공하지 않습니다." />
      <CheckForm />
    </div>
  );
}
