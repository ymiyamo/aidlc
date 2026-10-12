import { DishImageView } from './images/DishImageView';
import { COOK_TIME_LABEL, EFFORT_LABEL, isSafeUrl, type DishDto } from './types';

/** 候補の大きなカード。画像は U6 の部品が出す（なければ「AI が作ったイメージ」の印つきの画像か、色の枠） */
export function DishCard({
  dish,
  onToggleFavorite,
}: {
  dish: DishDto;
  onToggleFavorite?: () => void;
}) {
  const meta = [
    dish.cookTime ? COOK_TIME_LABEL[dish.cookTime] : null,
    dish.effort ? EFFORT_LABEL[dish.effort] : null,
  ].filter(Boolean);

  return (
    <article className="card dish-card" data-testid="dish-card" aria-label={dish.name}>
      <DishImageView dishId={dish.id} name={dish.name} />
      <h2 data-testid="dish-name">{dish.name}</h2>
      <p className="meta" data-testid="dish-meta">
        {meta.length ? meta.join('・') : '調理時間・手間は未入力'}
        {onToggleFavorite ? (
          <button
            type="button"
            className="icon-btn fav"
            data-testid="fav-button"
            aria-pressed={dish.isFavorite}
            aria-label={dish.isFavorite ? 'お気に入りから外す' : 'お気に入りにする'}
            onClick={onToggleFavorite}
          >
            {dish.isFavorite ? '♥' : '♡'}
          </button>
        ) : dish.isFavorite ? (
          <span className="fav" aria-label="お気に入り">
            ♥
          </span>
        ) : null}
      </p>
      {dish.moodTags.length > 0 && (
        <ul className="tags" data-testid="dish-tags" aria-label="気分のタグ">
          {dish.moodTags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {dish.ingredients.length === 0 && (
        <p className="badge" data-testid="no-ingredients">
          材料が未入力
        </p>
      )}
      {isSafeUrl(dish.url) && (
        <a
          className="btn block"
          data-testid="open-original"
          href={dish.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          元の動画・投稿を開く ↗
        </a>
      )}
    </article>
  );
}
