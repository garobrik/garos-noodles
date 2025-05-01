import { clsx } from 'clsx';

type Props = {
  src: string;
  alt: string;
  className: string;
};
export const Image = ({ src, className, alt }: Props) => {
  if (src.startsWith('/')) {
    src = import.meta.env.BASE_URL + src.replace('/', '');
  }
  src = normalize(src);
  return (
    <img src={src} alt={alt} className={clsx('mx-auto pb-4', className)} />
  );
};

const normalize = (url: string) =>
  '/' + url.split('/').filter(Boolean).join('/');
