import './style.css';

export default function LayoutDefault({ children }: React.PropsWithChildren) {
  return (
    <div className="m-auto max-w-[100rem] px-4">
      <nav className="flex flex-row items-baseline gap-x-8 py-8">
        <a href="/" className="text-4xl font-bold mr-2 text-accent">
          garo brik
        </a>
        <a href="/about" className="text-xl font-semibold">
          about
        </a>
      </nav>
      <main className="m-auto max-w-[50rem] px-4">{children}</main>
    </div>
  );
}
