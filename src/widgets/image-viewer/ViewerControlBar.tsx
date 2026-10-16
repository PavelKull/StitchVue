import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import { Tooltip } from "../../shared/ui/Tooltip";
import barStyles from "../bottom-control-bar/BottomControlBar.module.scss";

type ViewerControlBarProps = {
  zoomIndex: number;
  zoomSteps: number;
  fillScreen: boolean;
  onZoomIndex: (index: number) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onToggleFillScreen: () => void;
  appFullscreen: boolean;
  onToggleFullscreen: () => void;
  onRotate?: () => void;
  onOpenProperties?: () => void;
  favoriteOn?: boolean;
  favoriteDisabled?: boolean;
  onFavorite?: () => void;
  deleteDisabled?: boolean;
  onDelete?: () => void;
  restoreDisabled?: boolean;
  onRestore?: () => void;
  recycleDisabled?: boolean;
  onRecycleToWindows?: () => void;
};

export function ViewerControlBar({
  zoomIndex,
  zoomSteps,
  fillScreen,
  onZoomIndex,
  onZoomOut,
  onZoomIn,
  onToggleFillScreen,
  appFullscreen,
  onToggleFullscreen,
  onRotate,
  onOpenProperties,
  favoriteOn = false,
  favoriteDisabled = false,
  onFavorite,
  deleteDisabled = false,
  onDelete,
  restoreDisabled = false,
  onRestore,
  recycleDisabled = false,
  onRecycleToWindows,
}: ViewerControlBarProps) {
  const { t } = useTranslation();
  const showFileActions =
    onFavorite !== undefined || onDelete !== undefined || onRestore !== undefined || onRecycleToWindows !== undefined;
  return (
    <nav className={barStyles.bar} data-overflow="visible" aria-label={t("viewer.controlsAria")}>
      <div className={barStyles.group} role="group" aria-label={t("viewer.screenSizeGroupAria")}>
        <Tooltip text={fillScreen ? t("viewer.fillScreenOffHint") : t("viewer.fillScreenOnHint")}>
          <button
            type="button"
            className={fillScreen ? barStyles.controlActive : barStyles.control}
            aria-label={fillScreen ? t("viewer.fillScreenOffAria") : t("viewer.fillScreenOnAria")}
            aria-pressed={fillScreen}
            onClick={onToggleFillScreen}
          >
            <StitchVueIcon name="zoom-fit" className={barStyles.icon} />
            <span className={barStyles.controlLabel}>{t("viewer.fillScreen")}</span>
          </button>
        </Tooltip>
        <Tooltip text={appFullscreen ? t("viewer.fullscreenExitHint") : t("viewer.fullscreenEnterHint")}>
          <button
            type="button"
            className={appFullscreen ? barStyles.controlActive : barStyles.control}
            aria-label={appFullscreen ? t("viewer.fullscreenExitAria") : t("viewer.fullscreenEnterAria")}
            aria-pressed={appFullscreen}
            onClick={onToggleFullscreen}
          >
            <StitchVueIcon
              name={appFullscreen ? "fullscreen-exit" : "fullscreen-enter"}
              className={barStyles.icon}
            />
            <span className={barStyles.controlLabel}>
              {appFullscreen ? t("viewer.fullscreenExitAria") : t("viewer.fullscreenEnterAria")}
            </span>
          </button>
        </Tooltip>
      </div>

      <span className={barStyles.divider} aria-hidden="true" />

      <div className={barStyles.zoomGroup} role="group" aria-label={t("viewer.zoomGroupAria")}>
        {onRotate ? (
          <Tooltip text={t("viewer.rotateClockwise")}>
            <button
              type="button"
              className={barStyles.control}
              aria-label={t("viewer.rotateClockwise")}
              onClick={onRotate}
            >
              <StitchVueIcon name="rotate-clockwise-lucide" className={barStyles.icon} />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip text={t("viewer.zoomOut")}>
          <button type="button" className={barStyles.control} aria-label={t("viewer.zoomOut")} onClick={onZoomOut}>
            <StitchVueIcon name="zoom-out" className={barStyles.icon} />
          </button>
        </Tooltip>
        <input
          className={barStyles.zoomSlider}
          type="range"
          min={0}
          max={Math.max(0, zoomSteps - 1)}
          value={zoomIndex}
          aria-label={t("viewer.zoom")}
          style={
            {
              "--zoom-fill": `${(zoomIndex / Math.max(1, zoomSteps - 1)) * 100}%`,
            } as CSSProperties
          }
          onChange={(event) => onZoomIndex(Number(event.target.value))}
        />
        <Tooltip text={t("viewer.zoomIn")}>
          <button type="button" className={barStyles.control} aria-label={t("viewer.zoomIn")} onClick={onZoomIn}>
            <StitchVueIcon name="zoom-in" className={barStyles.icon} />
          </button>
        </Tooltip>
      </div>

      {showFileActions ? (
        <>
          <span className={barStyles.divider} aria-hidden="true" />
          <div className={barStyles.group} role="group" aria-label={t("viewer.photoActionsAria")}>
            {onFavorite ? (
              <Tooltip text={favoriteOn ? t("viewer.favoriteRemoveAria") : t("viewer.favoriteAddAria")}>
                <button
                  type="button"
                  className={favoriteOn ? barStyles.controlActive : barStyles.control}
                  aria-label={favoriteOn ? t("viewer.favoriteRemoveAria") : t("viewer.favoriteAddAria")}
                  aria-pressed={favoriteOn}
                  disabled={favoriteDisabled}
                  onClick={onFavorite}
                >
                  <StitchVueIcon
                    name="favorite"
                    className={favoriteOn ? `${barStyles.icon} ${barStyles.iconFilled}` : barStyles.icon}
                  />
                </button>
              </Tooltip>
            ) : null}
            {onRestore ? (
              <Tooltip text={t("viewer.trashRestoreAria")}>
                <button
                  type="button"
                  className={barStyles.control}
                  aria-label={t("viewer.trashRestoreAria")}
                  disabled={restoreDisabled}
                  onClick={onRestore}
                >
                  <StitchVueIcon name="file-restore" className={barStyles.icon} />
                </button>
              </Tooltip>
            ) : null}
            {onRecycleToWindows ? (
              <Tooltip text={t("trash.viewerDeleteToWindows")}>
                <button
                  type="button"
                  className={barStyles.control}
                  aria-label={t("trash.viewerDeleteToWindows")}
                  disabled={recycleDisabled}
                  onClick={onRecycleToWindows}
                >
                  <StitchVueIcon name="trash" className={barStyles.icon} />
                </button>
              </Tooltip>
            ) : null}
            {onDelete ? (
              <Tooltip text={t("viewer.trashMoveAria")}>
                <button
                  type="button"
                  className={barStyles.control}
                  aria-label={t("viewer.trashMoveAria")}
                  disabled={deleteDisabled}
                  onClick={onDelete}
                >
                  <StitchVueIcon name="trash" className={barStyles.icon} />
                </button>
              </Tooltip>
            ) : null}
          </div>
        </>
      ) : null}

      {onOpenProperties ? (
        <>
          <span className={barStyles.divider} aria-hidden="true" />
          <Tooltip text={t("viewer.propertiesHint")}>
            <button
              type="button"
              className={barStyles.control}
              aria-label={t("viewer.propertiesHint")}
              onClick={onOpenProperties}
            >
              <StitchVueIcon name="info" className={barStyles.icon} />
            </button>
          </Tooltip>
        </>
      ) : null}
    </nav>
  );
}
