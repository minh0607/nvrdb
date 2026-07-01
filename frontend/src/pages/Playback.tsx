import { useState, useCallback, useEffect } from 'react';
import { VideoPlayer } from '../components/video/VideoPlayer';
import { Timeline } from '../components/playback/Timeline';
import { useNvrStore } from '../stores/nvr.store';
import { api } from '../lib/api';
import type { Camera, StreamUrls } from '../types/api';
import { Calendar, Play, ChevronDown } from 'lucide-react';

export function Playback() {
  const { nvrs, cameras, fetchNvrs, fetchCameras } = useNvrStore();

  const [selectedNvrId, setSelectedNvrId] = useState<number | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0],
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(5);
  const [playbackStream, setPlaybackStream] = useState<StreamUrls | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (nvrs.length === 0) fetchNvrs();
  }, [nvrs.length, fetchNvrs]);

  const nvrCameras = selectedNvrId ? cameras.get(selectedNvrId) ?? [] : [];

  const handleNvrChange = async (nvrId: number) => {
    setSelectedNvrId(nvrId);
    setSelectedCamera(null);
    setPlaybackStream(null);
    if (!cameras.get(nvrId)) {
      await fetchCameras(nvrId);
    }
  };

  const handlePlay = useCallback(async () => {
    if (!selectedNvrId || !selectedCamera) return;

    setIsLoading(true);
    try {
      const hours = Math.floor(currentTime / 60);
      const mins = currentTime % 60;
      const time = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

      const result = await api.getPlaybackUrls(selectedNvrId, selectedCamera.channel, {
        date: selectedDate,
        time,
        duration: duration * 60, // convert to seconds
      });

      setPlaybackStream(result);
    } catch {
      // Playback fetch failed; stream stays null and the empty state is shown.
    } finally {
      setIsLoading(false);
    }
  }, [selectedNvrId, selectedCamera, selectedDate, currentTime, duration]);

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-end gap-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        {/* NVR selector */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
            NVR Device
          </label>
          <div className="relative">
            <select
              value={selectedNvrId ?? ''}
              onChange={(e) => handleNvrChange(Number(e.target.value))}
              className="appearance-none w-48 px-3 py-2 pr-8 text-sm bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
            >
              <option value="">Select NVR...</option>
              {nvrs.map((nvr) => (
                <option key={nvr.id} value={nvr.id}>
                  {nvr.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-dim)] pointer-events-none" />
          </div>
        </div>

        {/* Camera selector */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
            Camera
          </label>
          <div className="relative">
            <select
              value={selectedCamera?.id ?? ''}
              onChange={(e) => {
                const cam = nvrCameras.find((c) => c.id === Number(e.target.value));
                setSelectedCamera(cam ?? null);
                setPlaybackStream(null);
              }}
              disabled={!selectedNvrId}
              className="appearance-none w-48 px-3 py-2 pr-8 text-sm bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-accent)] cursor-pointer disabled:opacity-40"
            >
              <option value="">Select camera...</option>
              {nvrCameras.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  {cam.name} (Ch {cam.channel})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-dim)] pointer-events-none" />
          </div>
        </div>

        {/* Date picker */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
            Date
          </label>
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setPlaybackStream(null);
              }}
              className="w-44 px-3 py-2 text-sm bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
            Duration (min)
          </label>
          <div className="relative">
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="appearance-none w-24 px-3 py-2 pr-8 text-sm bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-accent)] cursor-pointer"
            >
              {[1, 5, 10, 15, 30, 60].map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-dim)] pointer-events-none" />
          </div>
        </div>

        {/* Play button */}
        <button
          onClick={handlePlay}
          disabled={!selectedCamera || isLoading}
          className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play className="w-4 h-4" />
          {isLoading ? 'Loading...' : 'Play'}
        </button>
      </div>

      {/* Video player area */}
      <div className="flex-1 min-h-0 bg-black rounded-xl overflow-hidden border border-[var(--color-border)]">
        {playbackStream ? (
          <VideoPlayer
            streamUrls={playbackStream}
            cameraName={`${selectedCamera?.name} - ${selectedDate}`}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--color-text-dim)]">
            <div className="text-center">
              <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a camera and date to start playback</p>
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
        <Timeline
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          duration={duration}
        />
      </div>
    </div>
  );
}
