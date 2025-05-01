import { usePageContext } from 'vike-react/usePageContext';

export default function Page() {
  const { is404 } = usePageContext();
  if (is404) {
    return (
      <div className="flex flex-col items-center">
        <h1>couldn't find that noodle!</h1>
        <p>must've slipped away</p>
      </div>
    );
  }
  return (
    <>
      <h1>error</h1>
    </>
  );
}
