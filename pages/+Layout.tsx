import { Link } from '../components/Link';
import './style.css';

export default function LayoutDefault({ children }: React.PropsWithChildren) {
  return (
    <div className="m-auto max-w-[50rem] px-4">
      <nav className="space-between-wrap py-4">
        <Link href="/" className="text-2xl sm:text-4xl font-semibold">
          garo's noodle garden
        </Link>
        <Link href="/about" className="text-lg font-semibold">
          about
        </Link>
      </nav>
      <main className="m-auto pb-20">{children}</main>
    </div>
  );
}
