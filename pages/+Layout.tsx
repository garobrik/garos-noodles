import { Link } from '../components/Link';
import { Spaghetti } from '../components/Spaghetti';
import './style.css';

export default function LayoutDefault({ children }: React.PropsWithChildren) {
  return (
    <div className="m-auto max-w-[45rem] px-4">
      <nav className="space-between-wrap py-4">
        <Link
          href="/"
          className="inline-block font-serif font-soft text-2xl font-semibold sm:text-4xl"
        >
          garo's noodle garden
          <Spaghetti seed="/" variant="underline" />
        </Link>
        <div className="flex gap-4">
          <Link
            href="/about"
            className="font-serif font-soft text-lg sm:text-xl font-semibold"
          >
            subscribe
          </Link>
          <Link
            href="/about"
            className="font-serif font-soft text-lg sm:text-xl font-semibold"
          >
            about
          </Link>
        </div>
      </nav>
      <main className="m-auto pb-20">{children}</main>
    </div>
  );
}
