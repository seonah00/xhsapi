import type {ReactNode} from 'react';

export default function DashboardLayout({children}:{children:ReactNode}) {
 return <div className="mobile-dashboard min-w-0">{children}</div>;
}
