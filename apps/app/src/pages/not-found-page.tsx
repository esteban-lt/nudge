import { Link } from 'react-router'
import { cn } from '@/lib/utils'

export function NotFoundPage({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-6 px-4 text-center',
        fullScreen ? 'min-h-svh bg-background text-foreground' : 'min-h-[60svh]',
      )}
    >
      <div className="flex items-center">
        <h1 className="m-0 border-r border-border pr-6 mr-6 text-2xl font-medium leading-[49px]">404</h1>
        <p className="m-0 text-sm leading-[49px]">Esta página no existe.</p>
      </div>
      <Link to="/" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Volver al inicio
      </Link>
    </div>
  )
}
