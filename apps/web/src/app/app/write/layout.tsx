import type {ReactNode} from 'react';

export default function LibraryLayout({children}:{children:ReactNode}) {
 return <div className="learning-library min-w-0">{children}</div>;
}
