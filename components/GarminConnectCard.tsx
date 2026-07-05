import { formatGarminSyncTime } from '@/lib/garmin/sync-staleness'

interface Props {
  garminConnected: boolean
  editingGarmin: boolean
  garminSuccess: boolean
  garminEmail: string
  garminPassword: string
  garminError: string | null
  garminConnecting: boolean
  savedGarminEmail: string
  garminLastSyncAt: string | null
  labelClass: string
  inputClass: string
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onStartEditing: () => void
  onCancelEditing: () => void
  onConnect: () => void
  onDisconnect: () => void
}

export default function GarminConnectCard({
  garminConnected, editingGarmin, garminSuccess, garminEmail, garminPassword, garminError,
  garminConnecting, savedGarminEmail, garminLastSyncAt, labelClass, inputClass,
  onEmailChange, onPasswordChange, onStartEditing, onCancelEditing, onConnect, onDisconnect,
}: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Garmin Connect</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {garminConnected
              ? `Connected as ${savedGarminEmail}`
              : 'Connect for training readiness, training status & live body battery'}
          </p>
        </div>
        {garminConnected && !editingGarmin && (
          <button
            onClick={onStartEditing}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 -m-2 p-2"
          >
            Edit
          </button>
        )}
      </div>
      <div className="px-4 py-4">
        {garminSuccess && (
          <p className="text-xs text-emerald-600 font-medium mb-3">Garmin Connect linked successfully.</p>
        )}
        {(editingGarmin || !garminConnected) ? (
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Garmin email</label>
              <input
                type="email"
                value={garminEmail}
                onChange={e => onEmailChange(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
                autoComplete="email"
              />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input
                type="password"
                value={garminPassword}
                onChange={e => onPasswordChange(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
                autoComplete="current-password"
              />
            </div>
            {garminError && (
              <p className="text-xs text-red-500">{garminError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onConnect}
                disabled={garminConnecting || !garminEmail.trim() || !garminPassword.trim()}
                className="flex-1 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {garminConnecting ? 'Connecting…' : 'Connect'}
              </button>
              {(editingGarmin || garminConnected) && (
                <button
                  onClick={onCancelEditing}
                  className="py-2.5 px-4 text-sm font-medium text-gray-500 rounded-lg border border-gray-200"
                >
                  Cancel
                </button>
              )}
            </div>
            {garminConnected && (
              <button
                onClick={onDisconnect}
                className="w-full py-3 text-xs text-red-500 hover:text-red-600"
              >
                Disconnect Garmin
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              <p className="text-sm text-gray-700">Syncs on each Sync tap</p>
            </div>
            <p className="text-xs text-gray-500">
              {garminLastSyncAt ? `Last synced: ${formatGarminSyncTime(garminLastSyncAt)}` : 'Not yet synced'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
