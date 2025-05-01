import './style.css';

export default function LayoutDefault({ children }: React.PropsWithChildren) {
  return (
    <div className="m-auto max-w-[60rem] px-4">
      <nav className="flex flex-wrap items-baseline justify-between gap-x-4 py-4">
        <a href="/" className="text-3xl xs:text-4xl font-semibold mr-2">
          garo's noodle garden
        </a>
        <a className="text-xl font-semibold" href="/about">
          about
        </a>
      </nav>
      <main className="m-auto max-w-[50rem] px-4 pb-20">{children}</main>
    </div>
  );
}
