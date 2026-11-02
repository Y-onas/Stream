import {Icon} from './Icons';

// Visual entry only. Future modules can replace this unavailable state with a
// real route/action once the corresponding feature is implemented.
export function ProfileFeatureEntry({icon,label,description}) {
  return <button type="button" className="profile-feature" aria-disabled="true" title={`${label} is not available yet`}>
    <span className="profile-feature-icon"><Icon name={icon} size={21}/></span>
    <span className="profile-feature-copy"><strong>{label}</strong><span>{description}</span></span>
    <span className="profile-feature-status">Coming soon</span>
  </button>;
}
