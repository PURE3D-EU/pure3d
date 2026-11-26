function plainText(value) {
	return String(value || '')
		.replace(/&nbsp;/g, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&(amp|lt|gt);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>' })[entity])
		.replace(/\s+/g, ' ')
		.trim();
}
function shouldQueue(previousStatus, currentStatus) {
	return (previousStatus === '' || previousStatus === 'draft') && currentStatus === 'submitted';
}
function deliveryEnabled(environmentValue, smtpEnabled) {
	return environmentValue === 'true' && smtpEnabled === true;
}
function queueState(previousStatus, currentStatus, now, original, enabled) {
	if (!enabled || !shouldQueue(previousStatus, currentStatus)) return original;
	return { emailQueuedAt: now, emailAttemptedAt: '', emailSentAt: '', emailAttempts: 0 };
}
function createDelivery(feedback, recipientEmails) {
	const severity = feedback.severity || 'minor';
	return {
		subject: 'New Pure3D feedback (' + severity + ')',
		body: [
			'New Pure3D feedback was submitted.',
			'',
			'Participant: ' + (feedback.participantName || 'Anonymous'),
			'Participant email: ' + (feedback.participantEmail || 'Not provided'),
			'Category: ' + (feedback.category || 'other'),
			'Severity: ' + severity,
			'Page: ' + (feedback.pageUrl || feedback.editionUrl || 'Not provided'),
			'',
			plainText(feedback.feedbackHtml) || 'No written feedback.'
		].join('\n'),
		recipients: recipientEmails.filter(Boolean)
	};
}
module.exports = { createDelivery, deliveryEnabled, plainText, queueState, shouldQueue };
