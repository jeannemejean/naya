import { useState } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import { DashboardModal } from "@uppy/react";
import AwsS3 from "@uppy/aws-s3";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";

interface UploadTarget {
  method: "PUT";
  url: string;
  /** URL publique finale (R2) — propagée jusqu'au onComplete via file.meta.publicUrl. */
  publicUrl?: string;
}

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  /** Types acceptés (par défaut image + vidéo). */
  allowedFileTypes?: string[];
  /** Reçoit le fichier, renvoie l'URL présignée (PUT) + l'URL publique finale. */
  onGetUploadParameters: (file: { name?: string; type?: string }) => Promise<UploadTarget>;
  onComplete?: (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => void;
  buttonClassName?: string;
  children: ReactNode;
}

/**
 * Bouton + modale d'upload (Uppy) vers un stockage S3-compatible (Cloudflare R2).
 * L'URL publique finale est attachée à chaque fichier (`file.meta.publicUrl`) pour être
 * récupérée dans `onComplete` (les médias sont servis depuis R2, pas depuis l'endpoint présigné).
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 524288000, // 500 Mo par défaut (vidéo)
  allowedFileTypes = ["image/*", "video/*"],
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [uppy] = useState(() => {
    const u = new Uppy({
      restrictions: { maxNumberOfFiles, maxFileSize, allowedFileTypes },
      autoProceed: false,
    });
    u.use(AwsS3, {
      shouldUseMultipart: false,
      getUploadParameters: async (file: any) => {
        const target = await onGetUploadParameters({ name: file.name, type: file.type });
        if (target.publicUrl) u.setFileMeta(file.id, { publicUrl: target.publicUrl });
        return {
          method: target.method,
          url: target.url,
          // Le Content-Type doit correspondre à celui signé côté serveur.
          headers: file.type ? { "Content-Type": file.type } : undefined,
        };
      },
    });
    u.on("complete", (result) => onComplete?.(result));
    return u;
  });

  return (
    <div>
      <Button onClick={() => setShowModal(true)} className={buttonClassName} data-testid="button-upload-media">
        {children}
      </Button>

      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
